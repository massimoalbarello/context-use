import {
  created,
  durableSubject,
  event,
  fact,
  hasView,
  linked,
  meeting,
  organization,
  person,
  relationship,
  story,
  timelineEvent,
  unique,
  updated,
} from "../../../runner/story/types.ts";

export const imacDesignAndLaunch = story({
  id: "imac-design-and-launch",
  title: "iMac design and unveiling",
  description: "Design decisions remain distinct from the later public unveiling while both connect to iMac.",
  subjects: {
    jony: person({ names: ["Jony Ive", "Jonathan Ive"] }),
    apple: organization({ names: ["Apple", "Apple Computer"] }),
    imac: durableSubject({ names: ["iMac"], concepts: ["all-in-one", "internet", "Macintosh"] }),
    designReview: meeting({
      date: "1998-03-12",
      participants: ["jony"], organizations: ["apple"], about: ["imac"],
      concepts: ["Bondi blue", "USB", "floppy"],
    }),
    unveiling: event({
      names: ["iMac unveiling", "Flint Center"],
      date: "1998-05-06",
      organizations: ["apple"], about: ["imac"],
      concepts: ["1299", "August"],
    }),
  },
  turns: [
    {
      id: "design-review",
      date: "1998-03-12",
      user: `Design review with Jony Ive today. The iMac stays a one-piece translucent Bondi blue
machine with a carrying handle. It has to feel approachable and make getting onto the
internet simple, not look like another beige box. We are removing the floppy drive and
betting on USB.`,
      expect: [
        created("jony"), created("apple"), created("imac"), created("designReview"),
        hasView("designReview", "intro"), unique("designReview"),
        linked("designReview", "jony"), linked("designReview", "apple"), linked("designReview", "imac"),
        relationship("jony", "apple", { any: ["design", "designer"] }),
        relationship("apple", "jony", { any: ["design", "designer"] }),
        fact("imac", { all: ["Bondi blue", "carrying handle", "USB", "floppy"] }),
        timelineEvent("jony", { date: "1998-03-12", occurrence: "designReview" }),
        timelineEvent("apple", { date: "1998-03-12", occurrence: "designReview" }),
      ],
    },
    {
      id: "unveiling",
      date: "1998-05-06",
      user: `We unveiled the iMac at Flint Center today. The price is $1,299 and it will ship in
August. The positioning is the excitement of the internet with the simplicity of Macintosh.`,
      expect: [
        created("unveiling"), updated("imac"), updated("apple"),
        linked("unveiling", "imac"), linked("unveiling", "apple"),
        fact("imac", { all: ["1299", "August", "internet", "Macintosh"] }),
        timelineEvent("apple", { date: "1998-05-06", occurrence: "unveiling" }),
        timelineEvent("imac", { date: "1998-05-06", occurrence: "unveiling" }),
      ],
    },
  ],
});
