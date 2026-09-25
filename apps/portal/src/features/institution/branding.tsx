'use client';

import { useEffect } from 'react';

import { useInstitution } from './use-institution';

/** Applies the institution's colour and name to the page (the theme reads --brand-primary). */
export function Branding() {
  const { profile } = useInstitution();

  useEffect(() => {
    if (!profile) return;
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', profile.primaryColor);
    root.lang = profile.locale;
    return () => {
      root.style.removeProperty('--brand-primary');
    };
  }, [profile]);

  return null;
}
