import { READER_DOC_VERSION, type ReaderBlock, type ReaderChapter, type ReaderDoc } from "../types";
import { tokenizeBlock } from "../tokenize";

// The permanent "sample" book: opens at /read/sample, doubles as the onboarding "Try the reader" demo, and is the
// fixture every reader test builds on. Real prose about the reader itself so a first run teaches the controls.
const CHAPTERS: { title: string; paragraphs: string[] }[] = [
  {
    title: "Welcome to the reader",
    paragraphs: [
      "This is a sample book. It exists so you can try the reader before you bring in anything of your own. If you are looking at a single word in the middle of the screen, you are already reading in the fast mode, and the word is changing at a steady pace. Press the space bar, or tap the large button at the bottom, to pause it whenever you like.",
      "Notice the red letter. Every word is placed so that one letter, the one your eye naturally lands on, sits in exactly the same spot on the screen. Your eyes never have to hunt for the start of the next word. They stay still while the text moves to them, and that is most of the trick.",
      "The pace is measured in words per minute. A comfortable adult reading speed on paper is somewhere around two hundred and fifty words per minute, and most people can follow three hundred or more in this mode without losing the thread. Use the up and down arrow keys, or the plus and minus buttons, to change the speed by small steps while you read. Start slower than you think you need to. Speed is something you grow into, not something you demand on the first page.",
      "Commas and full stops are given a little extra time, and so are long words and the ends of paragraphs. That is deliberate. A reader that treats every word the same feels like a machine gun; one that breathes with the sentence feels like a voice. If you ever lose your place, press the left arrow to jump back to the start of the sentence, and press it again to go back one more. The right arrow moves forward by a sentence. Hold the shift key with either arrow to move by whole paragraphs instead.",
      "You can see the whole text at any time. Switch to the page view and the book appears as ordinary paragraphs with the current word highlighted. Tap any word to jump there, and switch back to continue from that exact spot. Your place is saved as you go, so closing the app in the middle of a sentence costs you nothing.",
    ],
  },
  {
    title: "Why one word at a time",
    paragraphs: [
      "When you read normally, your eyes do not glide along the line. They jump from one resting point to the next, and the jumps are quick, only a few hundredths of a second each. Almost all of the actual seeing happens during the pauses between them. A surprising amount of the time on a page goes to the small corrections: sliding back to check a word, drifting to the wrong line, or re-reading a sentence because your mind wandered for a moment.",
      "Showing one word at a time removes the jumping altogether. There is nothing to find and nowhere to wander, so attention has a single place to be. For many people this is the real benefit, more than the raw speed. The screen asks for your focus, and gives you a steady rhythm to hold it with.",
      "It is not magic, and it is worth being honest about the limits. Understanding a hard argument takes time to build, and no display can shorten the thinking. Dense technical writing, poetry and anything you need to study carefully will usually be better at a lower speed, or in the page view where you can see the shape of the paragraph. Fast mode shines on narrative, on articles you want to get through, and on material you already know something about.",
      "A good habit is to read in short runs. Ten minutes of focused reading, then a pause to ask yourself what the last section actually said, will do more for you than an hour of passive scrolling. The scrubber at the bottom shows how far you have come and roughly how many minutes remain at your current pace, which makes it easy to decide whether to finish a chapter now or stop at a natural break.",
      "If a word or sentence strikes you, mark it. The highlight control keeps a note of the passage so you can return to it later without hunting through the book. Reading becomes more than consumption when you leave a trail behind you.",
    ],
  },
  {
    title: "Reading well, on purpose",
    paragraphs: [
      "Tools change what is easy, and what is easy changes what we do. A reader that makes it effortless to open a book and begin is a small nudge, but small nudges repeated every day are how habits are built. The aim here is not to read more words. It is to make the beginning of a reading session so light that you actually sit down to do it.",
      "Choose a time and keep it. Many people find that the first part of the morning or the last part of the evening works best, simply because nothing else has claimed it yet. Put the phone in another room if you can. If you cannot, at least put it face down, and let the reader be the only thing on the screen. A single task, held for a short and definite time, is far easier to start than an open-ended promise to read for a while.",
      "Set a gentle daily goal. A few hundred words is plenty to begin with, and a short streak of days is more motivating than one heroic afternoon. When the goal is small, you will usually do more than it asks, and on the bad days you can still count a win. Over a month those little wins add up to a whole book you might never have otherwise finished.",
      "Look after your eyes and your posture. Take the font size up if the text feels like a strain, and pick the theme that suits the room: dark for the evening, light or sepia for the daytime. The high contrast theme is there for anyone who finds the others too soft. Every one of these choices is yours, and they are remembered the next time you return.",
      "When you finish a section, close your eyes for a moment and say, in your own words, what it was about. If you cannot, go back and read it again in the page view at an easy pace. That small act of retrieval is what turns reading into remembering, and it is the same principle that powers the rest of Self-Mastery: what you pull out of your memory is what stays there.",
      "That is everything you need. Go back to the library and add something you actually want to read, or keep exploring with this sample until the controls feel natural. The best way to learn a tool like this is to use it for a little while on something that matters to you. Enjoy the book.",
    ],
  },
];

function build(): ReaderDoc {
  const blocks: ReaderBlock[] = [];
  const chapters: ReaderChapter[] = [];
  let words = 0;
  for (const ch of CHAPTERS) {
    chapters.push({ title: ch.title, blockIndex: blocks.length, firstWord: words });
    blocks.push({ kind: "h", text: ch.title, firstWord: words });
    words += tokenizeBlock(ch.title).length;
    for (const p of ch.paragraphs) {
      blocks.push({ kind: "p", text: p, firstWord: words });
      words += tokenizeBlock(p).length;
    }
  }
  return {
    version: READER_DOC_VERSION,
    title: "A Quick Tour of the Reader",
    author: "Life OS",
    source: "text",
    sourceUrl: null,
    blocks,
    chapters,
    wordCount: words,
  };
}

export const SAMPLE_DOC: ReaderDoc = build();
export const SAMPLE_BOOK_ID = "sample";
