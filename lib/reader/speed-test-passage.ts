// Original text written for Life OS (no third-party material). The questions test the gist and two details, not trivia.

export interface SpeedTestQuestion {
  prompt: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
}

export const SPEED_TEST_TITLE = "The Lighthouse Keeper's Ledger";

export const SPEED_TEST_PARAGRAPHS: string[] = [
  "For almost forty years, Marta Illescu climbed the same one hundred and twelve steps every evening. At the top of the lighthouse stood a lamp the size of a wardrobe, and beside it a plain wooden desk holding a ledger bound in green cloth. Each night she wrote down the weather, the height of the swell, and the name of every ship that passed. She never wrote anything else.",
  "The harbour authority had asked for the ledger only in the first year. After that nobody collected it, nobody read it, and the shelves in the stairwell slowly filled with identical green volumes. A visiting engineer once asked why she bothered. Marta shrugged and said the sea was never the same twice, and that a record was the only way to prove it.",
  "Then came the autumn of the great storm. Wind tore the roofs from three fishing sheds, and the harbour lost power for two days. When the coastguard needed to know whether a similar swell had ever reached the breakwater, nobody could answer. Someone remembered the lighthouse. Marta carried down thirty-eight ledgers, and a young clerk spent a weekend turning their pages.",
  "He found it in volume nineteen: a single line from a night in March, noting waves that had topped the wall by a full arm's length. Because she had also recorded the wind direction, the coastguard could see what had happened before that night as well. They moved the new floodgates two hundred metres west.",
  "Marta was not thanked in any ceremony. She kept climbing the steps, and the next evening she wrote the date, the tide, and one ship, a small blue ferry, heading home.",
];

export const SPEED_TEST_QUESTIONS: SpeedTestQuestion[] = [
  {
    prompt: "Why did Marta keep writing in the ledger after the harbour authority stopped collecting it?",
    options: ["She was paid for every entry", "She believed a record was the only proof that the sea changes", "She planned to publish a book", "The coastguard required it"],
    answer: 1,
  },
  {
    prompt: "What did the clerk find in volume nineteen?",
    options: ["A map of the harbour", "A list of every ship's owner", "A night when waves topped the wall by an arm's length", "A letter from the engineer"],
    answer: 2,
  },
  {
    prompt: "What did the coastguard do with the information?",
    options: ["Closed the lighthouse", "Moved the new floodgates two hundred metres west", "Raised the breakwater by a full metre", "Hired Marta as an engineer"],
    answer: 1,
  },
];

export const SPEED_TEST_WORDS: number = SPEED_TEST_PARAGRAPHS.join(" ").split(/\s+/).filter(Boolean).length;
