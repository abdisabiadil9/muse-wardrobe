/** Application-owned contracts. Provider credentials never belong in these objects. */
export type AssetOrigin = 'owned' | 'wishlist' | 'reference';
export type OutfitSlot = 'outerwear' | 'top' | 'bottom' | 'shoes' | 'accessory';

export interface OutfitItemRef {
  id: string;
  origin: AssetOrigin;
  slot: OutfitSlot;
  locked: boolean;
  variantId?: string;
}

export interface OutfitDraftContract {
  id: string;
  revision: number;
  items: OutfitItemRef[];
  inspirationId?: string;
  occasion?: string;
  budgetCny?: number;
}

export interface RecommendationEvidence {
  productId: string;
  reason: string;
  ownedItemIds: string[];
  sourceUrl?: string;
  fetchedAt?: string;
  priceCny?: number;
  priceStatus: 'demo' | 'verified' | 'unknown';
}

export interface IntegrationCapabilities {
  mode: 'demo' | 'live';
  qoder: boolean;
  catalog: boolean;
  decart: boolean;
}

/** Proposed application endpoints, NOT Qoder or Decart provider endpoints. */
export const backendEndpoints = {
  capabilities: '/api/integrations/status',
  createConversation: '/api/conversations',
  messages: (id: string) => `/api/conversations/${encodeURIComponent(id)}/messages`,
  events: (id: string) => `/api/conversations/${encodeURIComponent(id)}/events`,
  recommendations: '/api/recommendations',
  outfits: '/api/outfits',
  feedback: '/api/fit-feedback',
  decartToken: '/api/tryon/client-token',
} as const;
