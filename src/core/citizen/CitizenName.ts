import { hash32 } from '../utils/hash32';

/**
 * Citizen names.
 *
 * Derived from the id and the **city seed** rather than saved: a name is pure decoration, citizens
 * number in the tens of thousands, and one string each is hundreds of kilobytes of save file and
 * memory. Deriving from the id also means older saves have names on load with no migration.
 *
 * The city seed is essential. Citizen ids are a per-session sequence from 1, so from the id alone
 * every new city's first citizen has the same name — a replay of one list rather than random
 * naming. The seed is saved in `GameState.citySeed`, so a city's citizens keep their names across
 * a save and load.
 *
 * The cost is repeated names. The tables produce GIVEN x FAMILY combinations and collide beyond
 * that, which is accepted: two John Whitakers in a large city is ordinary, ids remain unique, and
 * the interface prints `#id` beside the name.
 */

/** Given names. */
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

/** Family names. */
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
 * Scrambles the id.
 *
 * A plain `id % table length` gives consecutive ids consecutive names, and citizen ids are a
 * sequence: one building's residents would run down the name table in order, which reads as
 * obviously generated. The hash is shared with building names (`utils/hash32`), because the
 * property that the city seed must be multiplied in has to hold for both.
 */
const scramble = hash32;

/** A given name. For `citySeed`, see the file header: one id must be a different person in a
 *  different city. */
export function citizenGivenName(id: number, citySeed = 0): string {
  return GIVEN_NAMES[scramble(id, 0x9e3779b9, citySeed) % GIVEN_NAMES.length]!;
}

/** A family name, with a different salt: sharing one would lock given and family names
 *  together, and the two tables would produce only max(len) distinct people. */
export function citizenFamilyName(id: number, citySeed = 0): string {
  return FAMILY_NAMES[scramble(id, 0x85ebca6b, citySeed) % FAMILY_NAMES.length]!;
}

/** "Given Family". */
export function citizenName(id: number, citySeed = 0): string {
  return `${citizenGivenName(id, citySeed)} ${citizenFamilyName(id, citySeed)}`;
}
