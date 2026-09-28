import "server-only";

export type CandidateMapping = {
  vantaSlug: string;
  provider: "panelfollows";
  providerServiceId: string;
  active: false;
  status: "APPROVED_FOR_MANUAL_ACTIVATION" | "MANUAL_REVIEW";
};

export const panelFollowsCandidateMappings: readonly CandidateMapping[] = [
  { vantaSlug: "instagram-likes", provider: "panelfollows", providerServiceId: "8", active: false, status: "APPROVED_FOR_MANUAL_ACTIVATION" },
  { vantaSlug: "instagram-views", provider: "panelfollows", providerServiceId: "297", active: false, status: "MANUAL_REVIEW" },
  { vantaSlug: "facebook-post-likes", provider: "panelfollows", providerServiceId: "3354", active: false, status: "APPROVED_FOR_MANUAL_ACTIVATION" },
  { vantaSlug: "facebook-video-views", provider: "panelfollows", providerServiceId: "3336", active: false, status: "MANUAL_REVIEW" },
  { vantaSlug: "x-post-views", provider: "panelfollows", providerServiceId: "2769", active: false, status: "APPROVED_FOR_MANUAL_ACTIVATION" },
  { vantaSlug: "telegram-post-views", provider: "panelfollows", providerServiceId: "9651", active: false, status: "MANUAL_REVIEW" },
];
