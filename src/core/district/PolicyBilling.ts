import { PolicyType } from './types';
import { maxLevel } from './PolicyManager';
import { LifeStage, type Citizen } from '../citizen/types';
import { parsePosKey } from '../grid/GridHelpers';

/** 費用跟著哪一個規模走。 */
export type BillingBasis =
  | 'flat' | 'population' | 'districtCells' | 'childcareRecipients' | 'clinicPatients'
  | 'chargedDrivers' | 'districtRoadCells';

/**
 * 各生命階段對免費診所的看診權重。成人是 1。
 *
 * 老人與嬰幼兒吃掉大部分的醫療支出，這是現實裡醫療費用年齡分布的形狀。按總人口
 * 計價的話，一座年輕城市與一座高齡城市的診所帳單一樣多 —— 而那正是這條條例最該
 * 讓玩家感覺到的差別。
 */
export const CLINIC_AGE_WEIGHT: Record<LifeStage, number> = {
  [LifeStage.BABY]: 2.5,
  [LifeStage.CHILD]: 1.2,
  [LifeStage.TEEN]: 0.8,
  [LifeStage.ADULT]: 1,
  [LifeStage.SENIOR]: 3,
};

/**
 * 全城規模。補貼型條例按「真正領得到的人」計費。
 *
 * 只有一個「人口」的話，育兒補貼在一座沒有小孩的城市也要付全額 —— 那筆錢沒有任何
 * 人領得到，玩家也看不出開了跟沒開差在哪。
 */
export interface CityScales {
  /** 全城人口。 */
  population: number;
  babies: number;
  children: number;
  teens: number;
  /**
   * 醫院覆蓋範圍內的人口，依年齡加權。
   *
   * 覆蓋範圍外的人不算 —— 醫院蓋不到的地方，人根本沒去看病，補助也就沒發出去。
   * 無家者同理:沒有家就沒有座標可查，判不出他在不在範圍內。
   */
  clinicPatients: number;
  /**
   * 付了壅塞費的通勤人數。
   *
   * 唯一一個**流量**基數 —— 其他都是存量（有多少人、多少格、多少病人）。收入要跟
   * 著它走，條例才會「越成功賺越少」;跟著格數走的話，荒地上的大收費區會變成
   * 印鈔機。
   */
  chargedDrivers: number;
}

/** 算費用要知道的規模。呼叫端負責填。 */
export interface PolicyScale extends CityScales {
  /** 這個條例所在分區的格數。全城條例填 0。 */
  districtCells: number;
  /**
   * 這個分區裡的**道路**格數。全城條例填 0。
   *
   * 門架架在路上，不是架在地上 —— 圈一片綠地不該產生任何門架維運費。
   */
  districtRoadCells: number;
}

/**
 * 從市民清單算出全城規模。
 *
 * 一趟走完 —— 每個量各掃一次的話，一座十萬人的城市每個預算週期要多走四趟。
 */
export function computeCityScales(
  citizens: readonly Citizen[],
  isHealthCovered: (x: number, y: number) => boolean,
): CityScales {
  let babies = 0, children = 0, teens = 0, clinicPatients = 0;
  for (const c of citizens) {
    if (c.lifeStage === LifeStage.BABY) babies++;
    else if (c.lifeStage === LifeStage.CHILD) children++;
    else if (c.lifeStage === LifeStage.TEEN) teens++;

    if (!c.homeId) continue;
    const pos = parsePosKey(c.homeId);
    if (!pos || !isHealthCovered(pos.x, pos.y)) continue;
    clinicPatients += CLINIC_AGE_WEIGHT[c.lifeStage];
  }
  return {
    population: citizens.length, babies, children, teens, clinicPatients,
    // 付費人數算不出來 —— 它要知道每個人選了什麼交通方式，那是通勤統計那一趟的
    // 產物。呼叫端自己補上，沒補就是 0（不收錢，不是亂收）。
    chargedDrivers: 0,
  };
}

/**
 * 每個條例怎麼收錢。
 *
 * 沒有條目 = 不收費。限制型條例（禁重工業、禁高密度）就屬於這一類:它們的代價是
 * 機會成本 —— 該區長不出高稅收的建築 —— 而不是市府掏錢。再收一次是雙重懲罰，
 * 而且那個數字沒有來由。
 *
 * `perUnit` 每一級一格，索引 0 是第 1 級，長度必須等於 `maxLevel(type)`。兩張表
 * 走散的話，第三級會靜靜地用第二級的價錢。
 *
 * 固定費用在大城市等於免費 —— 早期是限制，後期是無感。跟著規模走，費用才有來由，
 * 而且「政策越成功越貴」本身就是一個要玩家自己決定何時收手的張力。
 */
export const POLICY_BILLING: Partial<Record<PolicyType, {
  basis: BillingBasis;
  perUnit: readonly number[];
}>> = {
  [PolicyType.ENCOURAGE_RECYCLING]: { basis: 'districtCells', perUnit: [1.5, 4, 9] },
  [PolicyType.TOURISM]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.ORGANIC_FOOD]: { basis: 'districtCells', perUnit: [2] },
  // 全城條例沒有分區格數可言 —— 它服務的是整座城市，所以按人口收。
  [PolicyType.ENERGY_REGULATION]: { basis: 'population', perUnit: [0.08, 0.22, 0.5] },
  [PolicyType.LEGALIZE_GAMBLING]: { basis: 'districtCells', perUnit: [4] },
  [PolicyType.NIGHT_ECONOMY]: { basis: 'districtCells', perUnit: [2, 5] },
  [PolicyType.CURFEW]: { basis: 'districtCells', perUnit: [1.5, 4] },
  [PolicyType.HERITAGE_PRESERVATION]: { basis: 'districtCells', perUnit: [3] },
  [PolicyType.INDUSTRY_SUBSIDY]: { basis: 'districtCells', perUnit: [3, 7] },
  [PolicyType.SURVEILLANCE_NETWORK]: { basis: 'population', perUnit: [0.06, 0.15] },
  [PolicyType.PAY_AS_YOU_THROW]: { basis: 'population', perUnit: [0.05, 0.12] },
  [PolicyType.WATER_CONSERVATION]: { basis: 'population', perUnit: [0.07, 0.18, 0.42] },
  [PolicyType.SEWAGE_STANDARDS]: { basis: 'population', perUnit: [0.09, 0.24] },
  [PolicyType.INDUSTRIAL_EMISSION_CONTROL]: { basis: 'districtCells', perUnit: [2, 5, 11] },
  /**
   * 育兒補貼是按人頭發的:每個符合資格的孩子每期領一樣多，所以三級的單價相同。
   * 分級變的是**誰符合資格** —— 那才是這條條例在問的問題，而它反映在基數上，
   * 不在單價上。
   */
  [PolicyType.CHILDCARE_SUBSIDY]: { basis: 'childcareRecipients', perUnit: [1.2, 1.2, 1.2] },
  // 辦到哪一階就付到哪一階。跳得比線性快 —— 大學的單位成本本來就比國小高。
  [PolicyType.COMPULSORY_EDUCATION]: { basis: 'population', perUnit: [0.08, 0.20, 0.45] },
  // 診所按實際看得到的病人收費 —— 一座高齡城市的帳單本來就該比年輕城市重，而
  // 按總人口計價的話那個差別會整個不見。
  [PolicyType.FREE_CLINIC]: { basis: 'clinicPatients', perUnit: [0.35, 0.85] },
  // 禁菸令只有稽查成本。它真正的代價在商業收入那一欄。
  [PolicyType.SMOKING_BAN]: { basis: 'population', perUnit: [0.02] },
  // 門架與稽查跟著**分區內的道路格數**走，不是總格數 —— 門架架在路上，圈一片
  // 綠地不該產生任何維運費。
  [PolicyType.CONGESTION_CHARGE]: { basis: 'districtRoadCells', perUnit: [2.5, 6] },
};

/**
 * 這個基數在這個等級下有多少單位。
 *
 * `level` 是給「範圍會隨等級變寬」的基數用的:育兒補貼補到哪一階，就數到哪一階。
 * 那個對應寫在這裡而不是效果表 —— 它是計費規則，不是模擬效果。
 */
function unitsOf(basis: BillingBasis, scale: PolicyScale, level: number): number {
  switch (basis) {
    case 'flat': return 1;
    case 'population': return scale.population;
    case 'districtCells': return scale.districtCells;
    case 'childcareRecipients':
      return scale.babies
        + (level >= 2 ? scale.children : 0)
        + (level >= 3 ? scale.teens : 0);
    case 'clinicPatients': return scale.clinicPatients;
    case 'chargedDrivers': return scale.chargedDrivers;
    case 'districtRoadCells': return scale.districtRoadCells;
  }
}

/**
 * 每個條例每一級**賺**多少。
 *
 * 跟計費表分開兩張，不是讓單價帶正負號 —— 一條條例可以同時兩邊都有:壅塞費的門架
 * 要維運（跟著收費區的格數走），過路費要收（跟著還在開車的人走）。一個帶正負號的
 * 數字表達不了兩個方向各自跟著不同的東西變。
 *
 * 分開還有一個好處:計費表既有的不變量（單價必須是正數、逐級要更貴）原封不動就
 * 繼續守得住支出，收入這邊自己有一組同形狀的。
 */
export const POLICY_REVENUE: Partial<Record<PolicyType, {
  basis: BillingBasis;
  perUnit: readonly number[];
}>> = {
  // 過路費。跟著「還有多少人在開車」走，所以政策越成功收得越少 —— 做到極致會
  // 賠錢，因為門架照樣要養。那正是這條條例要玩家自己拿捏的地方。
  [PolicyType.CONGESTION_CHARGE]: { basis: 'chargedDrivers', perUnit: [1.8, 3.2] },
};

function amountOf(
  table: Partial<Record<PolicyType, { basis: BillingBasis; perUnit: readonly number[] }>>,
  type: PolicyType, level: number, scale: PolicyScale,
): number {
  if (level <= 0) return 0;
  const entry = table[type];
  if (!entry) return 0;
  const perUnit = entry.perUnit[Math.min(level, maxLevel(type)) - 1];
  if (perUnit === undefined) return 0;
  return perUnit * unitsOf(entry.basis, scale, level);
}

/** 這個條例在這個等級、這個規模下，每個預算週期要花多少。 */
export function policyCost(type: PolicyType, level: number, scale: PolicyScale): number {
  return amountOf(POLICY_BILLING, type, level, scale);
}

/** 這個條例在這個等級、這個規模下，每個預算週期收得到多少。 */
export function policyRevenue(type: PolicyType, level: number, scale: PolicyScale): number {
  return amountOf(POLICY_REVENUE, type, level, scale);
}
