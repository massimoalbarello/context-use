---
id: note-0012
date: 2026-03-20
topic: orange-mode
mentions: [people/anna-petrov]
---

Had a long call with [Anna Petrov](people/anna-petrov) today about their orange-mode implementation. I've been skeptical of these adaptive compute frameworks—too many startups slap "dynamic resource allocation" on a pitch deck without understanding the thermal constraints of real deployments.

But Anna walked me through their edge case handling, and I'm genuinely impressed. The way they throttle inference loads during peak grid stress isn't just clever engineering; it's the kind of grid-aware thinking that makes AI infrastructure actually deployable at scale without becoming another emissions nightmare.

She mentioned they're seeing 34% reduction in peak power draw during orange-mode events, which tracks with what we've modeled internally. The question I keep circling back to: can this approach generalize beyond their current data center partnerships, or is it too dependent on specific utility relationships?

Going to push for a deeper technical diligence session. If the architecture holds, this could reshape how we think about AI compute sustainability.