import { hash32 } from '../utils/hash32';

/**
 * 市民的名字。
 *
 * 從 id 與**城市種子**算出來，不存進存檔:名字是純粹的裝飾，而市民數量是以萬計的，
 * 每人多背一個字串就是幾百 KB 的存檔與記憶體。從 id 算還有一個好處 —— 舊存檔一載入
 * 就有名字，不必寫遷移。
 *
 * 城市種子非帶不可。市民 id 是每一局各自從頭數的流水號，只看 id 的話每一座新城市的
 * 第一個市民都叫同一個名字 —— 那是同一份名單重播，不是隨機取名。種子存在存檔裡
 * （`GameState.citySeed`），所以同一座城市讀檔前後叫的是同一個人。
 *
 * 代價是名字會重複。名字表能組出 GIVEN × FAMILY 種組合，超過就一定撞 —— 這是接受
 * 的:一座大城市裡有兩個 John Whitaker 本來就很正常，而 id 仍然是唯一的，介面上也
 * 還是會把 `#id` 印在名字旁邊。
 */

/** 名。 */
export const GIVEN_NAMES: readonly string[] = [
  'Adam', 'Aisha', 'Alan', 'Alice', 'Amara', 'Amir', 'Andre', 'Anita',
  'Anna', 'Arjun', 'Bela', 'Ben', 'Bianca', 'Bruno', 'Carla', 'Carlos',
  'Chen', 'Clara', 'Colin', 'Dana', 'Daniel', 'Dario', 'Dawit', 'Diana',
  'Dmitri', 'Ede', 'Elena', 'Eli', 'Emeka', 'Emma', 'Enzo', 'Esther',
  'Fatima', 'Felix', 'Fiona', 'Frank', 'Gabor', 'Gina', 'Greta', 'Hana',
  'Hugo', 'Ida', 'Ines', 'Irene', 'Ivan', 'Jack', 'Jae', 'Jamal',
  'Jana', 'Jasper', 'Jin', 'Joan', 'John', 'Jonas', 'Julia', 'Kai',
  'Karin', 'Kemal', 'Kenji', 'Lars', 'Laura', 'Leo', 'Lena', 'Liam',
  'Lucia', 'Luis', 'Maja', 'Malik', 'Marco', 'Maria', 'Marta', 'Mateo',
  'Maya', 'Mila', 'Mina', 'Nadia', 'Nils', 'Nina', 'Noah', 'Nora',
  'Olga', 'Omar', 'Oscar', 'Paula', 'Pedro', 'Petra', 'Priya', 'Rafa',
  'Rania', 'Rita', 'Rosa', 'Ruben', 'Ruth', 'Samir', 'Sara', 'Sean',
  'Sofia', 'Sven', 'Tara', 'Theo', 'Tomas', 'Vera', 'Viktor', 'Wei',
  'Yara', 'Yusuf', 'Zara', 'Zoe',
];

/** 姓。 */
export const FAMILY_NAMES: readonly string[] = [
  'Abara', 'Adler', 'Aguilar', 'Almeida', 'Andersen', 'Bakker', 'Baranov', 'Beckett',
  'Bellini', 'Berger', 'Blanco', 'Bordeaux', 'Braga', 'Cabrera', 'Calder', 'Castillo',
  'Chandra', 'Chowdhury', 'Clarke', 'Costa', 'Delacroix', 'Demir', 'Dimitrov', 'Donnelly',
  'Duarte', 'Eriksen', 'Falk', 'Farhadi', 'Ferreira', 'Fischer', 'Fontana', 'Garcia',
  'Gebre', 'Grimaldi', 'Haddad', 'Halvorsen', 'Hartmann', 'Hayashi', 'Herrera', 'Holloway',
  'Ibarra', 'Ivanov', 'Jansen', 'Kaminski', 'Kaur', 'Keller', 'Khan', 'Kimura',
  'Kovacs', 'Kowalski', 'Laurent', 'Lindqvist', 'Lombardi', 'Machado', 'Maguire', 'Mahdi',
  'Marchetti', 'Mbeki', 'Mendoza', 'Moreau', 'Nakamura', 'Navarro', 'Nguyen', 'Nilsson',
  'Novak', 'Odongo', 'Okafor', 'Oliveira', 'Osei', 'Pavlenko', 'Pereira', 'Petrov',
  'Quintero', 'Rahman', 'Ramirez', 'Reyes', 'Ricci', 'Rossi', 'Salvatore', 'Sandoval',
  'Santos', 'Sato', 'Schneider', 'Seong', 'Silva', 'Sokolov', 'Sorensen', 'Steiner',
  'Tanaka', 'Tavares', 'Thorne', 'Toledo', 'Vargas', 'Vasquez', 'Vogel', 'Volkov',
  'Wagner', 'Whitaker', 'Wilder', 'Yamada', 'Yilmaz', 'Zhang', 'Ziegler', 'Zuberi',
];

/**
 * 把 id 打散。
 *
 * 直接 `id % 表長` 會讓連號的 id 拿到連號的名字，而市民 id 就是流水號 —— 同一棟樓
 * 的住戶會照名字表的順序排下來，一看就是假的。雜湊與建築的名字共用一份
 * （`utils/hash32`），因為「城市種子要用乘的」那條性質兩邊都要成立。
 */
const scramble = hash32;

/** 名。`citySeed` 見檔頭:同一個 id 在不同城市要是不同的人。 */
export function citizenGivenName(id: number, citySeed = 0): string {
  return GIVEN_NAMES[scramble(id, 0x9e3779b9, citySeed) % GIVEN_NAMES.length]!;
}

/** 姓。用另一顆鹽，不然姓與名會鎖在一起，兩張表只組得出 max(len) 種人。 */
export function citizenFamilyName(id: number, citySeed = 0): string {
  return FAMILY_NAMES[scramble(id, 0x85ebca6b, citySeed) % FAMILY_NAMES.length]!;
}

/** 「名 姓」。 */
export function citizenName(id: number, citySeed = 0): string {
  return `${citizenGivenName(id, citySeed)} ${citizenFamilyName(id, citySeed)}`;
}
