import type { RechnungStatus } from '../../../types/db';

export const RECHNUNG_STATUS_LABEL: Record<RechnungStatus, string> = {
  entwurf: 'Entwurf',
  offen: 'Offen',
  bezahlt: 'Bezahlt',
};
