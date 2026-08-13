import {
  created,
  durableSubject,
  event,
  fact,
  linked,
  organization,
  person,
  relationship,
  story,
  timelineEvent,
  updated,
} from "../../../runner/story/types.ts";

export const rokrPartnership = story({
  id: "rokr-partnership",
  title: "Motorola ROKR partnership roles",
  description: "A launch involving three companies is clarified into distinct manufacturing, software, and distribution roles.",
  subjects: {
    ed: person({ names: ["Ed Zander"] }),
    ralph: person({ names: ["Ralph de la Vega"] }),
    apple: organization({ names: ["Apple"] }),
    motorola: organization({ names: ["Motorola"] }),
    cingular: organization({ names: ["Cingular Wireless", "Cingular"] }),
    rokr: durableSubject({ names: ["Motorola ROKR", "ROKR"] }),
    launch: event({
      names: ["Motorola ROKR launch"], date: "2005-09-07",
      participants: ["ed", "ralph"], organizations: ["apple", "motorola", "cingular"],
      about: ["rokr"], concepts: ["100 songs", "249.99"],
    }),
  },
  turns: [
    {
      id: "launch",
      date: "2005-09-07",
      user: `We launched the Motorola ROKR with Ed Zander, Ralph de la Vega and Cingular today.
Ed is Motorola's chairman and CEO; Ralph is Cingular's COO. The phone carries up to 100
iTunes songs. Cingular has exclusive US distribution, and the phone is $249.99 with a
two-year commitment.`,
      expect: [
        created("ed"), created("ralph"), created("apple"), created("motorola"),
        created("cingular"), created("rokr"), created("launch"),
        linked("launch", "ed"), linked("launch", "ralph"), linked("launch", "apple"),
        linked("launch", "motorola"), linked("launch", "cingular"), linked("launch", "rokr"),
        relationship("ed", "motorola", { any: ["CEO", "chairman"] }),
        relationship("motorola", "ed", { any: ["CEO", "chairman"] }),
        relationship("ralph", "cingular", { any: ["COO", "chief operating"] }),
        relationship("cingular", "ralph", { any: ["COO", "chief operating"] }),
        fact("rokr", { all: ["100", "iTunes", "249.99", "two-year"] }),
        timelineEvent("apple", { date: "2005-09-07", occurrence: "launch" }),
        timelineEvent("motorola", { date: "2005-09-07", occurrence: "launch" }),
        timelineEvent("cingular", { date: "2005-09-07", occurrence: "launch" }),
      ],
    },
    {
      id: "role-clarification",
      date: "2005-09-07",
      user: `Keep the roles clear: Motorola makes the handset, Cingular distributes it, and Apple
provides iTunes.`,
      expect: [
        updated("motorola"), updated("cingular"), updated("apple"), updated("rokr"),
        relationship("motorola", "rokr", { any: ["makes", "manufacturer", "handset"] }),
        relationship("cingular", "rokr", { any: ["distributes", "distribution", "exclusive"] }),
        relationship("apple", "rokr", { any: ["iTunes", "software"] }),
      ],
    },
  ],
});
