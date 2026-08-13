import {
  created,
  event,
  exists,
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

export const microsoftPartnership = story({
  id: "microsoft-partnership",
  title: "Apple–Microsoft partnership",
  description: "A private agreement becomes a public Macworld announcement and must remain one connected account.",
  subjects: {
    bill: person({ names: ["Bill Gates"], concepts: ["Microsoft"] }),
    apple: organization({ names: ["Apple", "Apple Computer"] }),
    microsoft: organization({ names: ["Microsoft"] }),
    dealCall: meeting({
      names: ["Apple Microsoft agreement", "final call with Bill Gates"],
      date: "1997-08-05",
      participants: ["bill"],
      organizations: ["apple", "microsoft"],
      concepts: ["150 million", "non-voting", "Office"],
    }),
    macworld: event({
      names: ["Macworld Boston"],
      date: "1997-08-06",
      participants: ["bill"],
      organizations: ["apple", "microsoft"],
      concepts: ["partnership", "satellite"],
    }),
  },
  turns: [
    {
      id: "agreement",
      date: "1997-08-05",
      user: `I had the final call with Bill Gates today about resetting the relationship between
Apple and Microsoft. Bill is Microsoft's chairman. Microsoft will invest $150 million in non-voting Apple shares, keep
Office and Internet Explorer on the Mac, cross-license patents with us, and work with us
on Java. Bill will join tomorrow's Macworld Boston keynote by satellite.`,
      expect: [
        created("bill"), created("apple"), created("microsoft"), created("dealCall"),
        hasView("dealCall", "intro"), unique("dealCall"),
        linked("dealCall", "bill"), linked("dealCall", "apple"), linked("dealCall", "microsoft"),
        relationship("bill", "microsoft", { any: ["CEO", "chairman"] }),
        relationship("microsoft", "bill", { any: ["CEO", "chairman"] }),
        relationship("microsoft", "apple", { all: ["150 million", "non-voting"] }),
        fact("microsoft", { all: ["Office", "Internet Explorer", "patent", "Java"] }),
        timelineEvent("bill", { date: "1997-08-05", occurrence: "dealCall" }),
        timelineEvent("apple", { date: "1997-08-05", occurrence: "dealCall" }),
        timelineEvent("microsoft", { date: "1997-08-05", occurrence: "dealCall" }),
      ],
    },
    {
      id: "announcement",
      date: "1997-08-06",
      user: `Macworld is done. Bill appeared by satellite and we announced the agreement. Make sure
my notes say non-voting shares, not an acquisition, and that Internet Explorer becomes
the default browser on the Mac, not the only browser.`,
      expect: [
        created("macworld"), updated("apple"), updated("microsoft"),
        linked("macworld", "bill"), linked("macworld", "apple"), linked("macworld", "microsoft"),
        fact("apple", { all: ["Internet Explorer", "default browser"], any: ["not the only", "other browsers"] }),
        fact("microsoft", { all: ["non-voting"], any: ["not an acquisition", "investment"] }),
        timelineEvent("bill", { date: "1997-08-06", occurrence: "macworld" }),
        timelineEvent("apple", { date: "1997-08-06", occurrence: "macworld" }),
        timelineEvent("microsoft", { date: "1997-08-06", occurrence: "macworld" }),
      ],
    },
  ],
});
