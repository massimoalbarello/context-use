---
id: note-0024
date: 2026-02-24
topic: orange-mode
mentions: [people/marcus-reid]
---

Had a long call with [Marcus Reid](people/marcus-reid) today about what he's calling "orange-mode" operations at Terraform—basically the intermediate state between full autonomy and human-in-the-loop for their grid optimization systems. It's a fascinating framing.

The traditional binary of autonomous vs. supervised doesn't capture what's actually happening in critical infrastructure deployments. Orange-mode acknowledges that there's a middle ground where the system has earned enough trust to operate independently in normal conditions but automatically escalates when it encounters edge cases or confidence drops below threshold.

Marcus walked me through their implementation—it's not just about confidence scores, it's about maintaining interpretable decision logs so operators can quickly context-switch when the system hands off. The cognitive load on human operators during these transitions is something most teams underestimate.

I keep thinking about how this applies beyond grid management. Most of our portfolio companies building AI infrastructure for physical systems will need their own version of orange-mode. Worth exploring as a diligence framework.