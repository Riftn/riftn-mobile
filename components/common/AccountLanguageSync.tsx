/**
 * Tells the account which language this reader uses. Renders nothing.
 *
 * Pushes are written on the server, which has no phone to ask, so it writes
 * them in the account's `preferredLanguage`. This keeps that field on the
 * language the app is showing: once on sign-in when the two differ (after the
 * launch language has loaded), and again whenever the reader picks another
 * one. The web only writes it on a pick, so the phone's language wins.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isLanguageReady, languageReady } from '../../i18n';
import { useAuthState, useUser } from '../../context/AuthContext';
import { AuthService } from '../../services/auth.service';

export default function AccountLanguageSync() {
  const { i18n } = useTranslation();
  const { isSignedIn } = useAuthState();
  const user = useUser();
  const address = (user?.walletAddress || user?.address || '').toLowerCase();
  const saved = (user as { preferredLanguage?: string } | null)?.preferredLanguage;
  const language = (i18n.language || 'en').toLowerCase().split('-')[0];
  // What was last sent, per account, so a stale `user` does not resend it.
  const sent = useRef<string | null>(null);
  // At launch the app shows English for a moment while the reader's language
  // loads. Reporting that placeholder flipped a Turkish account's pushes to
  // English on every launch, so nothing is sent until the language settles.
  const [ready, setReady] = useState(isLanguageReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void languageReady.then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);

  useEffect(() => {
    if (!ready || !isSignedIn || !address || !/^[a-z]{2,3}$/.test(language)) return;
    const key = `${address}:${language}`;
    if (saved === language || sent.current === key) return;
    sent.current = key;
    AuthService.updateProfile({ preferredLanguage: language }).catch(() => {
      // Pushes stay in the last saved language; try again on the next change.
      if (sent.current === key) sent.current = null;
    });
  }, [ready, isSignedIn, address, saved, language]);

  return null;
}
