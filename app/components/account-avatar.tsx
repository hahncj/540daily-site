import { useState } from "react";

/** The member's Google profile picture, or their first initial when there is none or it fails to load. */
export function AccountAvatar({ name, email, image }: { name: string; email: string; image: string | null }) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim() || email).charAt(0).toUpperCase();
  if (image && !failed) {
    return (
      <img
        className="avatar"
        src={image}
        alt=""
        width={32}
        height={32}
        // Google's image host can refuse requests that carry a referrer.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="avatar avatar--initial" aria-hidden="true">
      {initial}
    </span>
  );
}
