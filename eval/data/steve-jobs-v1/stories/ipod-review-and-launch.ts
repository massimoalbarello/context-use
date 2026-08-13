import {
  created,
  durableSubject,
  fact,
  linked,
  meeting,
  noOccurrence,
  organization,
  person,
  relationship,
  story,
  timelineEvent,
  unique,
  updated,
} from "../../../runner/story/types.ts";

export const ipodReviewAndLaunch = story({
  id: "ipod-review-and-launch",
  title: "iPod final review and introduction",
  description: "A final product review establishes people and specifications before the introduction milestone.",
  subjects: {
    jon: person({ names: ["Jon Rubinstein"] }),
    tony: person({ names: ["Tony Fadell"] }),
    apple: organization({ names: ["Apple", "Apple Computer"] }),
    ipod: durableSubject({ names: ["iPod"], concepts: ["1000 songs", "FireWire", "iTunes"] }),
    itunes: durableSubject({ names: ["iTunes"] }),
    finalReview: meeting({
      date: "2001-10-22", participants: ["jon", "tony"], organizations: ["apple"],
      about: ["ipod", "itunes"], concepts: ["5 GB", "399", "FireWire"],
    }),
  },
  turns: [
    {
      id: "final-review",
      date: "2001-10-22",
      user: `Final iPod review with Jon Rubinstein and Tony Fadell today. Keep the 5 GB drive,
1,000-song promise, FireWire transfer, ten-hour battery, automatic iTunes sync, and the
$399 price.`,
      expect: [
        created("jon"), created("tony"), created("apple"), created("ipod"), created("itunes"),
        created("finalReview"), unique("finalReview"),
        linked("finalReview", "jon"), linked("finalReview", "tony"), linked("finalReview", "ipod"),
        linked("finalReview", "itunes"),
        fact("ipod", { all: ["5 GB", "1000", "FireWire", "399"], any: ["ten-hour", "10-hour"] }),
        relationship("ipod", "itunes", { any: ["sync", "automatic"] }),
        timelineEvent("jon", { date: "2001-10-22", occurrence: "finalReview" }),
        timelineEvent("tony", { date: "2001-10-22", occurrence: "finalReview" }),
      ],
    },
    {
      id: "introduction",
      date: "2001-10-23",
      user: `The iPod introduction is done. We announced it as 1,000 songs in your pocket, and it
ships November 10.`,
      expect: [
        updated("ipod"), updated("apple"),
        fact("ipod", { all: ["1000 songs", "November 10"] }),
        timelineEvent("ipod", { date: "2001-10-23" }),
        timelineEvent("apple", { date: "2001-10-23" }),
        noOccurrence("event", "2001-10-23", { any: ["iPod introduction"] }),
      ],
    },
  ],
});
