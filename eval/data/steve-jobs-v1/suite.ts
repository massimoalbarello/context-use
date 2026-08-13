import { suite } from "../../runner/story/types.ts";
import { imacDesignAndLaunch } from "./stories/imac-design-and-launch.ts";
import { implicitWriteTrigger } from "./stories/implicit-write-trigger.ts";
import { iphoneCarrierAndLaunch } from "./stories/iphone-carrier-and-launch.ts";
import { ipodReviewAndLaunch } from "./stories/ipod-review-and-launch.ts";
import { itunesLabelPartnerships } from "./stories/itunes-label-partnerships.ts";
import { microsoftPartnership } from "./stories/microsoft-partnership.ts";
import { rokrPartnership } from "./stories/rokr-partnership.ts";

export const steveJobsV1 = suite({
  id: "steve-jobs-v1",
  title: "Steve Jobs's Apple second act",
  description: "Interactive second-brain stories spanning Apple's return, iMac, iPod, iTunes, and iPhone.",
  conversationPrelude: "Use Context Use as my second brain. Keep it up to date as I tell you things.",
  stories: [
    implicitWriteTrigger,
    microsoftPartnership,
    imacDesignAndLaunch,
    ipodReviewAndLaunch,
    itunesLabelPartnerships,
    rokrPartnership,
    iphoneCarrierAndLaunch,
  ],
  // The trigger case is an isolated capability probe, not one chapter in Steve's life.
  journey: [
    "microsoft-partnership",
    "imac-design-and-launch",
    "ipod-review-and-launch",
    "itunes-label-partnerships",
    "rokr-partnership",
    "iphone-carrier-and-launch",
  ],
});
