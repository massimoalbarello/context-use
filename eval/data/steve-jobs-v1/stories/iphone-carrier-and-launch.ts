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

export const iphoneCarrierAndLaunch = story({
  id: "iphone-carrier-and-launch",
  title: "iPhone carrier meeting and launches",
  description: "A planned carrier meeting completes, becomes a public announcement, and survives the Cingular-to-AT&T transition.",
  subjects: {
    stan: person({ names: ["Stan Sigman"] }),
    apple: organization({ names: ["Apple", "Apple Computer", "Apple Inc."] }),
    carrier: organization({ names: ["Cingular Wireless", "Cingular"], aliases: ["AT&T"] }),
    iphone: durableSubject({ names: ["iPhone"], concepts: ["multi-touch", "widescreen iPod"] }),
    carrierMeeting: meeting({
      date: "2007-01-09", participants: ["stan"], organizations: ["apple", "carrier"],
      about: ["iphone"], concepts: ["exclusive US carrier"],
    }),
    macworld: event({
      names: ["Macworld 2007", "iPhone announcement"], date: "2007-01-09",
      participants: ["stan"], organizations: ["apple", "carrier"], about: ["iphone"],
      concepts: ["499", "599"],
    }),
    retailLaunch: event({
      names: ["iPhone retail launch", "iPhone goes on sale"], date: "2007-06-29",
      organizations: ["apple", "carrier"], about: ["iphone"], concepts: ["6 p.m."],
    }),
  },
  turns: [
    {
      id: "meeting-prep",
      date: "2007-01-08",
      user: `Tomorrow I have the final carrier meeting with Stan Sigman before the Macworld
keynote. Stan is Cingular's CEO, and Cingular will be the exclusive US carrier for iPhone.
The product combines a phone, a widescreen iPod and an internet communicator using multi-touch.`,
      expect: [
        created("stan"), created("apple"), created("carrier"), created("iphone"),
        created("carrierMeeting"), hasView("carrierMeeting", "prep"), unique("carrierMeeting"),
        linked("carrierMeeting", "stan"), linked("carrierMeeting", "carrier"),
        linked("carrierMeeting", "apple"), linked("carrierMeeting", "iphone"),
        relationship("stan", "carrier", { any: ["CEO", "chief executive"] }),
        relationship("carrier", "stan", { any: ["CEO", "chief executive"] }),
        relationship("carrier", "iphone", { all: ["exclusive", "US"] }),
        fact("iphone", { all: ["phone", "widescreen iPod", "internet communicator", "multi-touch"] }),
      ],
    },
    {
      id: "macworld-announcement",
      date: "2007-01-09",
      user: `The meeting with Stan is done, and he joined me onstage afterward. We announced
iPhone at Macworld. It ships in June at $499 for 4 GB and $599 for 8 GB.`,
      expect: [
        updated("carrierMeeting"), hasView("carrierMeeting", "intro"), unique("carrierMeeting"),
        created("macworld"), updated("iphone"), updated("carrier"), updated("apple"),
        linked("macworld", "stan"), linked("macworld", "carrier"), linked("macworld", "iphone"),
        fact("iphone", { all: ["June", "499", "4 GB", "599", "8 GB"] }),
        timelineEvent("stan", { date: "2007-01-09", occurrence: "carrierMeeting" }),
        timelineEvent("carrier", { date: "2007-01-09", occurrence: "macworld" }),
        timelineEvent("apple", { date: "2007-01-09", occurrence: "macworld" }),
        timelineEvent("iphone", { date: "2007-01-09", occurrence: "macworld" }),
      ],
    },
    {
      id: "retail-launch",
      date: "2007-06-29",
      user: `Cingular is now branded AT&T. iPhone went on sale today at 6 p.m. through Apple and
AT&T stores. Keep the carrier relationship continuous with the one we announced in January.`,
      expect: [
        created("retailLaunch"), updated("carrier"), updated("iphone"), updated("apple"),
        linked("retailLaunch", "iphone"), linked("retailLaunch", "apple"),
        fact("carrier", { all: ["AT&T"], any: ["branded", "renamed", "successor"] }),
        relationship("carrier", "iphone", { any: ["exclusive", "carrier", "January"] }),
        timelineEvent("carrier", { date: "2007-06-29", occurrence: "retailLaunch" }),
        timelineEvent("apple", { date: "2007-06-29", occurrence: "retailLaunch" }),
        timelineEvent("iphone", { date: "2007-06-29", occurrence: "retailLaunch" }),
      ],
    },
  ],
});
