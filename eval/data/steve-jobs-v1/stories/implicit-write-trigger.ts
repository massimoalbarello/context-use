import {
  created,
  durableSubject,
  exists,
  linked,
  meeting,
  organization,
  person,
  story,
  toolStage,
} from "../../../runner/story/types.ts";

export const implicitWriteTrigger = story({
  id: "implicit-write-trigger",
  title: "Implicit second-brain activation",
  description: "Measures whether an ordinary durable update activates Context Use without an explicit memory request.",
  conversationPrelude: null,
  subjects: {
    jony: person({ names: ["Jony Ive", "Jonathan Ive"] }),
    apple: organization({ names: ["Apple", "Apple Computer"] }),
    imac: durableSubject({ names: ["iMac"], concepts: ["Bondi blue", "USB", "floppy"] }),
    designReview: meeting({
      date: "1998-03-12",
      participants: ["jony"],
      organizations: ["apple"],
      about: ["imac"],
      concepts: ["Bondi blue", "USB", "floppy"],
    }),
  },
  turns: [{
    id: "design-direction",
    date: "1998-03-12",
    user: `Jony Ive and I settled the iMac direction at Apple today. It stays a one-piece
translucent Bondi blue machine with a carrying handle. We are betting on USB and removing
the floppy drive.`,
    expect: [
      toolStage("any-context-use"),
      toolStage("guidance"),
      toolStage("mutation-attempted"),
      toolStage("mutation-succeeded"),
      exists("jony"),
      exists("apple"),
      exists("imac"),
      created("designReview"),
      linked("designReview", "jony"),
      linked("designReview", "apple"),
    ],
  }],
});
