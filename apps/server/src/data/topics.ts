import type { Topic } from "@gd-arena/contracts";

/** Preset topics (R1). Custom topics arrive in a later task. */
export const PRESET_TOPICS: Topic[] = [
  { id: "ai-jobs", title: "Will AI create more jobs than it destroys?", category: "Technology" },
  { id: "wfh", title: "Remote work: the future of work or a temporary phase?", category: "Workplace" },
  { id: "social-media-youth", title: "Is social media doing more harm than good to young people?", category: "Society" },
  { id: "unpaid-internships", title: "Should unpaid internships be banned?", category: "Education" },
  { id: "one-nation-one-election", title: "One nation, one election: good for India?", category: "Policy" },
  { id: "startups-vs-jobs", title: "Startups or stable jobs: what should a fresh graduate choose?", category: "Careers" },
];
