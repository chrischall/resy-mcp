import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerReservationTools } from '../../src/tools/reservations.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('reservation tools (list/cancel)', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerReservationTools(server, mockClient));
  });

  describe('resy_list_reservations', () => {
    it('GETs /3/user/reservations and normalises the payload', async () => {
      mockRequest.mockResolvedValue({
        reservations: [
          {
            resy_token: 'rr://abc',
            reservation_id: 777,
            venue: { name: 'Carbone' },
            date: '2026-05-01',
            time_slot: '19:00',
            num_seats: 2,
            config: { type: 'Dining Room' },
            status: 'confirmed',
          },
        ],
      });

      const result = await harness.callTool('resy_list_reservations');

      const [method, path] = mockRequest.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toContain('/3/user/reservations');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"venue_name": "Carbone"');
      expect(text).toContain('"reservation_id": 777');
      expect(text).toContain('"time": "19:00"');
      expect(text).toContain('"party_size": 2');
    });

    it('includes scope in query string', async () => {
      mockRequest.mockResolvedValue({ reservations: [] });
      await harness.callTool('resy_list_reservations', { scope: 'past' });
      const [, path] = mockRequest.mock.calls[0];
      expect(path).toContain('scope=past');
    });

    it('handles "upcoming" key in response instead of "reservations"', async () => {
      mockRequest.mockResolvedValue({
        upcoming: [
          { resy_token: 'rr://x', reservation_id: 1, venue: { name: 'X' }, date: '2026-05-01', time_slot: '18:00', num_seats: 2 },
        ],
      });
      const result = await harness.callTool('resy_list_reservations');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"venue_name": "X"');
    });
  });

  describe('resy_cancel', () => {
    it('POSTs /3/cancel form-encoded with resy_token', async () => {
      mockRequest.mockResolvedValue({ ok: true, status: 'cancelled', refund: 0 });
      const result = await harness.callTool('resy_cancel', { resy_token: 'rr://abc' });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [method, path, body] = mockRequest.mock.calls[0];
      expect(method).toBe('POST');
      expect(path).toBe('/3/cancel');
      expect(body).toBeInstanceOf(URLSearchParams);
      expect((body as URLSearchParams).get('resy_token')).toBe('rr://abc');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled": true');
    });
  });
});
