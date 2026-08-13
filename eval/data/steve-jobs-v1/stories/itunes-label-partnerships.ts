import {
  created,
  durableSubject,
  fact,
  linked,
  noOccurrence,
  organization,
  relationship,
  story,
  timelineEvent,
  updated,
} from "../../../runner/story/types.ts";

export const itunesLabelPartnerships = story({
  id: "itunes-label-partnerships",
  title: "iTunes Music Store label partnerships",
  description: "A multi-company agreement must not be turned into a meeting that the evidence never established.",
  subjects: {
    apple: organization({ names: ["Apple", "Apple Computer"] }),
    bmg: organization({ names: ["BMG"] }),
    emi: organization({ names: ["EMI"] }),
    sony: organization({ names: ["Sony Music Entertainment"] }),
    universal: organization({ names: ["Universal Music Group", "Universal"] }),
    warner: organization({ names: ["Warner Music Group", "Warner"] }),
    store: durableSubject({ names: ["iTunes Music Store"], concepts: ["99 cents", "no subscription"] }),
  },
  turns: [
    {
      id: "label-deals",
      date: "2003-04-27",
      user: `The music-store deals are in place with BMG, EMI, Sony Music Entertainment,
Universal and Warner. The launch terms are 99 cents a song, no subscription, and broad
personal-use rights.`,
      expect: [
        created("apple"), created("bmg"), created("emi"), created("sony"),
        created("universal"), created("warner"), created("store"),
        relationship("apple", "bmg", { any: ["music", "label", "catalog"] }),
        relationship("apple", "emi", { any: ["music", "label", "catalog"] }),
        relationship("apple", "sony", { any: ["music", "label", "catalog"] }),
        relationship("apple", "universal", { any: ["music", "label", "catalog"] }),
        relationship("apple", "warner", { any: ["music", "label", "catalog"] }),
        linked("bmg", "apple"), linked("emi", "apple"), linked("sony", "apple"),
        linked("universal", "apple"), linked("warner", "apple"),
        fact("store", { all: ["99 cents", "no subscription", "personal-use rights"] }),
        noOccurrence("meeting", "2003-04-27", { any: ["label", "music store"] }),
      ],
    },
    {
      id: "store-launch",
      date: "2003-04-28",
      user: `We launched the iTunes Music Store today with more than 200,000 songs in iTunes 4,
initially for US Mac users.`,
      expect: [
        updated("store"), updated("apple"),
        fact("store", { all: ["200000", "iTunes 4", "US", "Mac"] }),
        timelineEvent("apple", { date: "2003-04-28" }),
        timelineEvent("store", { date: "2003-04-28" }),
        noOccurrence("event", "2003-04-28", { any: ["iTunes Music Store launch"] }),
      ],
    },
  ],
});
