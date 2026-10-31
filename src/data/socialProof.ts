interface ReviewQuote {
  rating: number;
  title: string;
  body: string;
  author: string;
}

interface FeaturedVideo {
  title: string;
  channel: string;
  youTubeID: string;
}

type SocialProofItem =
  | { kind: "review"; quote: ReviewQuote; colorIndex: number }
  | { kind: "video"; video: FeaturedVideo };

/**
 * Positive App Store reviews, kept in step with ReviewQuotes.swift in the app. Each body is one
 * unbroken excerpt of the original, word for word.
 */
const reviews: ReviewQuote[] = [
  { rating: 5, title: "10/10 app for utilising the whole camera sensor", body: "Excellent app that’s simple to use. It’s kinda crazy that it’s not a feature even on the Blackmagic app.", author: "A Homie For You" },
  { rating: 5, title: "Great App for many reasons", body: "The app is beautiful, it’s simple with a lot of depth.", author: "Bendana Banana" },
  { rating: 5, title: "Fantastic App", body: "Great app. Fantastic layout, with all controls easily accessible. Great quality video.", author: "okcomputer" },
  { rating: 5, title: "Current version shoots 4k open gate in log!", body: "The current version shoots 4k open gate in Apple Log 2 in whatever codec you choose! Freaking AWESOME!", author: "lkingston" },
  { rating: 5, title: "Awesome!", body: "UI is very well done. Love the zoom and exposure controls.", author: "JamesDoom412" },
  { rating: 5, title: "My favourite video app", body: "This app is wonderful. Very easy to use! I use it for all my video needs now", author: "wxl25" },
  { rating: 5, title: "Not bad at all", body: "I was really sceptical about this one but I have to say it’s really good - nice interface, no bugs", author: "Onesidemedia" },
  { rating: 5, title: "Cool app", body: "I like the ability it gives to completely customise my shooting options, very intuitive to use", author: "mrmrjing" },
  { rating: 5, title: "Fantastic! Footage looks great", body: "I’ve been using Kino to shoot apple log video, but this is my new app.", author: "theothersam123" },
  { rating: 5, title: "Great app for Open Gate videos", body: "It’s a great app definitely worth buying.", author: "Wiktt0r" },
  { rating: 5, title: "Very good", body: "Very good implementation with actual log output", author: "JustinW_AK" },
  { rating: 5, title: "It's great!", body: "The app is amazing and the developer should be praised to the lifetime pricing option", author: "PatrikZero" },
  { rating: 5, title: "Melhor app de app engate", body: "Estou adorando o app e usando em meus trabalhos. É o melhor app de open gate.", author: "EddySangalli" },
  { rating: 5, title: "Excellent", body: "Application testé et approuvé, très bien conçue et fiable", author: "Benji-unit" },
  { rating: 5, title: "非常好", body: "目前用下来4:3最好用的app", author: "Who's Chaos 1967" },
  { rating: 5, title: "Best open gate app for the iPhone 16 pro !", body: "Best Open Gate", author: "Dagalyum" },
  { rating: 5, title: "The best", body: "Great app. 5 stars", author: "Lex.G" },
  { rating: 4, title: "Easy and effective", body: "I really like the simplicity to record open gate", author: "DrCisneros" },
];

const videos: FeaturedVideo[] = [
  { title: "OpenCam is the First iPhone App to Shoot Open Gate Video in Apple Log!", channel: "Epic Tutorials for Mobile Filmmaking", youTubeID: "-q8B4AKs9ag" },
  { title: "What’s on my iPhone 17 Pro: Photographer’s Edition", channel: "Tyler Stalman", youTubeID: "RPdtKJ_UGy4" },
  { title: "Unlock This Smartphone Filmmaker Tool", channel: "Anthony Aguiar’s Organalog", youTubeID: "9kRGHQKcagc" },
  { title: "L’Open Gate pour tous les iPhone : OpenCam", channel: "Little Walk Of Fame", youTubeID: "lQ6TuOEUAd4" },
];

/**
 * Reviews with the videos spread through them, as in the app. The first video comes second, so
 * it is on screen almost straight away; the rest are spaced across the whole loop.
 */
export const socialProofItems: SocialProofItem[] = (() => {
  // Indexes of the reviews each video follows, in `videos` order.
  const videoAfterReview = [0, 3, 8, 13];
  const remaining = [...videos];
  const items: SocialProofItem[] = [];
  reviews.forEach((quote, index) => {
    items.push({ kind: "review", quote, colorIndex: index });
    if (videoAfterReview.includes(index) && remaining.length > 0) {
      items.push({ kind: "video", video: remaining.shift()! });
    }
  });
  items.push(...remaining.map((video) => ({ kind: "video" as const, video })));
  return items;
})();

/** First letters of the first two words, splitting nicknames like "Lex.G" or "JustinW_AK" too. */
export const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word].find((char) => /\p{L}/u.test(char)) ?? "")
    .join("")
    .toUpperCase();
