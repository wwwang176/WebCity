/**
 * 市民的名字。
 *
 * 從 id 算出來，不存進存檔:名字是純粹的裝飾，而市民數量是以萬計的，每人多背一個
 * 字串就是幾百 KB 的存檔與記憶體。從 id 算還有一個好處 —— 舊存檔一載入就有名字，
 * 不必寫遷移。
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
 * 的住戶會照名字表的順序排下來，一看就是假的。這是 splitmix32 的 finalizer，把低位
 * 的變化擴散到所有位元上。
 */
function scramble(id: number, salt: number): number {
  // 位元運算自己會做 ToInt32，負數、小數、超過 32 位元的 id 都在這裡被收乾淨 ——
  // 所以沒有另外夾一次範圍。夾了也沒有測試守得到，只是換一個名字而已。
  let h = (id ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** 名。 */
export function citizenGivenName(id: number): string {
  return GIVEN_NAMES[scramble(id, 0x9e3779b9) % GIVEN_NAMES.length]!;
}

/** 姓。用另一顆鹽，不然姓與名會鎖在一起，兩張表只組得出 max(len) 種人。 */
export function citizenFamilyName(id: number): string {
  return FAMILY_NAMES[scramble(id, 0x85ebca6b) % FAMILY_NAMES.length]!;
}

/** 「名 姓」。 */
export function citizenName(id: number): string {
  return `${citizenGivenName(id)} ${citizenFamilyName(id)}`;
}
