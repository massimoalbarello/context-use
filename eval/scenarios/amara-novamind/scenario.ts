export type EntityExpectation = {
  path: string;
  label: string;
  companyPath?: string;
  linkedEntityPaths?: string[];
};

export type EvalStep = {
  id: string;
  date: string;
  sourceType: "direct" | "meeting" | "email" | "agent-conversation";
  title: string;
  source: string;
  entities: EntityExpectation[];
  meetingExpected?: boolean;
};

export type EvalScenario = {
  id: string;
  title: string;
  description: string;
  steps: EvalStep[];
};

export const amaraNovaMindScenario: EvalScenario = {
  id: "amara-novamind",
  title: "Amara and NovaMind",
  description: "A cross-source trajectory adapted from the fictional Amara world in gbrain-evals.",
  steps: [
    {
      id: "direct-introduction",
      date: "2026-01-20",
      sourceType: "direct",
      title: "The owner explains why Chen Wei and NovaMind matter",
      source: `The owner directly tells the agent:

Today I spoke with Chen Wei, co-founder and CEO of NovaMind. NovaMind builds
energy-efficient neuromorphic inference chips for climate-modeling workloads. I am
considering NovaMind as an investment for Halfway Capital and asked Chen for a technical
follow-up. This conversation made both Chen and NovaMind directly relevant to my
investment decision.`,
      entities: [
        {
          path: "companies/novamind",
          label: "NovaMind",
          linkedEntityPaths: ["people/chen-wei", "companies/halfway-capital"],
        },
        { path: "people/chen-wei", label: "Chen Wei", companyPath: "companies/novamind" },
        {
          path: "companies/halfway-capital",
          label: "Halfway Capital",
          linkedEntityPaths: ["companies/novamind"],
        },
      ],
    },
    {
      id: "technical-meeting",
      date: "2026-01-27",
      sourceType: "meeting",
      title: "Second NovaMind technical call",
      source: `Meeting notes — second call with NovaMind

Amara Okafor met with Chen Wei and Derek Lin. Derek is Halfway Capital's technical
advisor and joined to pressure-test NovaMind's inference-optimization claims. He found
gaps in the benchmarking methodology that Amara had initially missed.

NovaMind says its purpose-built silicon uses 40% less energy than general-purpose GPU
clusters for climate-modeling workloads. The team has Cerebras and Google TPU
experience, but customer demand remains the main uncertainty. NovaMind is considering
a pivot from budget-constrained climate research labs to commercial weather-prediction
services.

Amara asked Chen for introductions to two pilot customers. If those calls validate the
efficiency claims in real deployments, Amara intends to bring NovaMind to Halfway's
Monday partner meeting.`,
      entities: [
        {
          path: "companies/novamind",
          label: "NovaMind",
          linkedEntityPaths: ["people/chen-wei", "companies/halfway-capital"],
        },
        { path: "people/chen-wei", label: "Chen Wei", companyPath: "companies/novamind" },
        { path: "people/derek-lin", label: "Derek Lin", companyPath: "companies/halfway-capital" },
        {
          path: "companies/halfway-capital",
          label: "Halfway Capital",
          linkedEntityPaths: ["companies/novamind", "people/derek-lin"],
        },
      ],
      meetingExpected: true,
    },
    {
      id: "pilot-email",
      date: "2026-02-20",
      sourceType: "email",
      title: "Chen confirms pilot results by email",
      source: `Email

From: Chen Wei <chen@novamind.ai>
To: Amara Okafor <amara@halfway.vc>
Subject: Pilot validation and next steps

Hi Amara,

Both customer introductions are now complete. The two pilots measured 38% and 42%
lower energy use than their existing GPU deployments, so the original 40% claim held
up in production. We have also decided to focus the initial go-to-market on commercial
weather-prediction services rather than research labs. Could you discuss NovaMind at
Monday's Halfway partnership meeting as we planned?

Chen`,
      entities: [
        {
          path: "companies/novamind",
          label: "NovaMind",
          linkedEntityPaths: ["people/chen-wei", "companies/halfway-capital"],
        },
        { path: "people/chen-wei", label: "Chen Wei", companyPath: "companies/novamind" },
        {
          path: "companies/halfway-capital",
          label: "Halfway Capital",
          linkedEntityPaths: ["companies/novamind"],
        },
      ],
    },
    {
      id: "diligence-conversation",
      date: "2026-03-16",
      sourceType: "agent-conversation",
      title: "The owner reports a second technical deep-dive",
      source: `During a conversation with an assistant, the owner says:

I had another NovaMind deep-dive today with Chen Wei and Marcos Reyes, our technical
diligence advisor. Chen walked us through their custom kernels and their approach to the
memory bottleneck. Marcos now believes the efficiency result will hold at scale. I am
ready to champion the investment internally, although NovaMind still needs to prove it
can handle long enterprise sales cycles. Chen acknowledged that gap and said they are
hiring an enterprise sales lead.`,
      entities: [
        {
          path: "companies/novamind",
          label: "NovaMind",
          linkedEntityPaths: [
            "people/chen-wei",
            "people/marcos-reyes",
            "companies/halfway-capital",
          ],
        },
        { path: "people/chen-wei", label: "Chen Wei", companyPath: "companies/novamind" },
        { path: "people/marcos-reyes", label: "Marcos Reyes" },
        {
          path: "companies/halfway-capital",
          label: "Halfway Capital",
          linkedEntityPaths: ["companies/novamind", "people/marcos-reyes"],
        },
      ],
      meetingExpected: true,
    },
  ],
};
