/**
 * Component: Audible Region Types
 * Documentation: documentation/integrations/audible.md
 */

export type AudibleRegion = 'us' | 'ca' | 'uk' | 'au' | 'in' | 'de' | 'es';

export interface AudibleRegionConfig {
  code: AudibleRegion;
  name: string;
  baseUrl: string;
  audnexusParam: string;
  isEnglish: boolean;
}

export const AUDIBLE_REGIONS: Record<AudibleRegion, AudibleRegionConfig> = {
  us: {
    code: 'us',
    name: 'United States',
    baseUrl: 'https://www.audible.com',
    audnexusParam: 'us',
    isEnglish: true,
  },
  ca: {
    code: 'ca',
    name: 'Canada',
    baseUrl: 'https://www.audible.ca',
    audnexusParam: 'ca',
    isEnglish: true,
  },
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    baseUrl: 'https://www.audible.co.uk',
    audnexusParam: 'uk',
    isEnglish: true,
  },
  au: {
    code: 'au',
    name: 'Australia',
    baseUrl: 'https://www.audible.com.au',
    audnexusParam: 'au',
    isEnglish: true,
  },
  in: {
    code: 'in',
    name: 'India',
    baseUrl: 'https://www.audible.in',
    audnexusParam: 'in',
    isEnglish: true,
  },
  de: {
    code: 'de',
    name: 'Germany',
    baseUrl: 'https://www.audible.de',
    audnexusParam: 'de',
    isEnglish: false,
  },
  es: {
    code: 'es',
    name: 'Spain',
    baseUrl: 'https://www.audible.es',
    audnexusParam: 'es',
    isEnglish: false,
  }
};

export const DEFAULT_AUDIBLE_REGION: AudibleRegion = 'us';
