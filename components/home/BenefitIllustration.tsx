type BenefitIllustrationProps = {
  kind: "visibility" | "confidence" | "simple";
};

export function BenefitIllustration({ kind }: BenefitIllustrationProps) {
  if (kind === "visibility") {
    return (
      <svg className="benefit-illustration" viewBox="0 0 600 520" role="img" aria-label="Illustration of social engagement growing">
        <defs>
          <linearGradient id="visibility-bg" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#39105f" />
            <stop offset="1" stopColor="#12071f" />
          </linearGradient>
          <linearGradient id="visibility-line" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#df41ef" />
            <stop offset="1" stopColor="#72e5ff" />
          </linearGradient>
          <linearGradient id="visibility-card" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#29123d" />
            <stop offset="1" stopColor="#180b28" />
          </linearGradient>
        </defs>
        <rect width="600" height="520" rx="46" fill="url(#visibility-bg)" />
        <circle cx="500" cy="90" r="112" fill="#a947f4" opacity=".15" />
        <circle cx="92" cy="446" r="142" fill="#df41ef" opacity=".1" />
        <path d="M54 395h492" stroke="#ffffff" strokeOpacity=".12" strokeWidth="2" />
        <path d="M54 310h492M54 225h492M54 140h492" stroke="#ffffff" strokeOpacity=".08" strokeWidth="2" strokeDasharray="7 12" />
        <rect x="76" y="70" width="448" height="378" rx="30" fill="url(#visibility-card)" stroke="#ffffff" strokeOpacity=".16" strokeWidth="2" />
        <text x="112" y="125" fill="#cdb7dc" fontFamily="Arial,sans-serif" fontSize="17" fontWeight="700" letterSpacing="2">ENGAGEMENT</text>
        <text x="108" y="180" fill="#fff" fontFamily="Arial,sans-serif" fontSize="40" fontWeight="800">Growing</text>
        <path d="m116 353 91-73 72 27 97-112 82-63" fill="none" stroke="url(#visibility-line)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m423 132 35-8-4 35" fill="none" stroke="#72e5ff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="207" cy="280" r="12" fill="#df41ef" stroke="#fff" strokeWidth="5" />
        <circle cx="279" cy="307" r="12" fill="#a947f4" stroke="#fff" strokeWidth="5" />
        <circle cx="376" cy="195" r="12" fill="#a947f4" stroke="#fff" strokeWidth="5" />
        <circle cx="458" cy="132" r="16" fill="#72e5ff" stroke="#fff" strokeWidth="5" />
        <g fill="#f9ed3d">
          <path d="m456 225 8 18 19 2-15 12 5 19-17-10-17 10 5-19-15-12 19-2z" />
          <path d="m130 214 5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" opacity=".8" />
        </g>
        <rect x="365" y="367" width="116" height="42" rx="21" fill="#df41ef" />
        <text x="423" y="394" fill="#170529" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="16" fontWeight="800">MOMENTUM</text>
      </svg>
    );
  }

  if (kind === "confidence") {
    return (
      <svg className="benefit-illustration" viewBox="0 0 600 520" role="img" aria-label="Illustration of a polished social media post">
        <defs>
          <linearGradient id="confidence-bg" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#7d35d0" />
            <stop offset="1" stopColor="#321054" />
          </linearGradient>
          <linearGradient id="confidence-post" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffb5dc" />
            <stop offset=".52" stopColor="#bb78ff" />
            <stop offset="1" stopColor="#38c9e8" />
          </linearGradient>
        </defs>
        <rect width="600" height="520" rx="46" fill="url(#confidence-bg)" />
        <circle cx="62" cy="120" r="118" fill="#df41ef" opacity=".19" />
        <circle cx="545" cy="449" r="138" fill="#09b8e7" opacity=".18" />
        <rect x="126" y="45" width="348" height="430" rx="32" fill="#fff" />
        <circle cx="169" cy="95" r="22" fill="#df41ef" />
        <path d="M160 96h18m-9-9v18" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <text x="205" y="91" fill="#210b36" fontFamily="Arial,sans-serif" fontSize="16" fontWeight="800">YOUR PROFILE</text>
        <text x="205" y="113" fill="#8e7c9c" fontFamily="Arial,sans-serif" fontSize="12">A clear place to start</text>
        <rect x="149" y="140" width="302" height="225" rx="22" fill="url(#confidence-post)" />
        <circle cx="295" cy="245" r="80" fill="#fff" opacity=".18" />
        <circle cx="295" cy="245" r="55" fill="#170529" opacity=".8" />
        <path d="M277 269v-48l18 18 18-18v48" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M181 317c34-46 63-53 89-23s53 31 81-13 55-36 83 4" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".8" />
        <path d="M166 399c0-10 8-18 18-18 9 0 15 5 19 12 4-7 10-12 19-12 10 0 18 8 18 18 0 22-37 43-37 43s-37-21-37-43z" fill="#f04d91" />
        <rect x="253" y="386" width="118" height="14" rx="7" fill="#e9e2ef" />
        <rect x="253" y="412" width="82" height="12" rx="6" fill="#eee9f2" />
        <circle cx="405" cy="401" r="22" fill="#f5edff" />
        <path d="m396 401 7 7 12-15" fill="none" stroke="#8d42d2" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="482" cy="156" r="39" fill="#f9ed3d" />
        <path d="m482 132 7 16 18 2-13 11 4 18-16-9-16 9 4-18-13-11 18-2z" fill="#170529" />
      </svg>
    );
  }

  return (
    <svg className="benefit-illustration" viewBox="0 0 600 520" role="img" aria-label="Illustration of a simple three-step order flow">
      <defs>
        <linearGradient id="simple-bg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#078fcf" />
          <stop offset="1" stopColor="#12336f" />
        </linearGradient>
        <linearGradient id="simple-card" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#eee8fa" />
        </linearGradient>
      </defs>
      <rect width="600" height="520" rx="46" fill="url(#simple-bg)" />
      <circle cx="515" cy="88" r="130" fill="#78e7ff" opacity=".18" />
      <circle cx="80" cy="467" r="145" fill="#df41ef" opacity=".17" />
      <path d="M130 135h340M130 260h340M130 385h340" stroke="#fff" strokeOpacity=".3" strokeWidth="4" strokeDasharray="8 12" />
      <rect x="92" y="68" width="416" height="384" rx="32" fill="#0e2050" fillOpacity=".56" stroke="#fff" strokeOpacity=".25" strokeWidth="2" />
      <rect x="119" y="91" width="362" height="89" rx="21" fill="url(#simple-card)" />
      <circle cx="164" cy="135" r="25" fill="#a947f4" />
      <text x="164" y="143" fill="#fff" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="23" fontWeight="800">1</text>
      <text x="207" y="130" fill="#190a2b" fontFamily="Arial,sans-serif" fontSize="17" fontWeight="800">CHOOSE A SERVICE</text>
      <text x="207" y="153" fill="#7a6a8b" fontFamily="Arial,sans-serif" fontSize="13">Pick a platform and goal</text>
      <rect x="119" y="215" width="362" height="89" rx="21" fill="url(#simple-card)" />
      <circle cx="164" cy="259" r="25" fill="#df41ef" />
      <text x="164" y="267" fill="#fff" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="23" fontWeight="800">2</text>
      <text x="207" y="254" fill="#190a2b" fontFamily="Arial,sans-serif" fontSize="17" fontWeight="800">ADD YOUR TARGET</text>
      <text x="207" y="277" fill="#7a6a8b" fontFamily="Arial,sans-serif" fontSize="13">Just the public link or profile</text>
      <rect x="119" y="339" width="362" height="89" rx="21" fill="url(#simple-card)" />
      <circle cx="164" cy="383" r="25" fill="#089df4" />
      <text x="164" y="391" fill="#fff" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="23" fontWeight="800">3</text>
      <text x="207" y="378" fill="#190a2b" fontFamily="Arial,sans-serif" fontSize="17" fontWeight="800">CHECK OUT SECURELY</text>
      <text x="207" y="401" fill="#7a6a8b" fontFamily="Arial,sans-serif" fontSize="13">Track progress from your account</text>
    </svg>
  );
}
