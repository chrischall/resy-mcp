import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerUserTools } from '../../src/tools/user.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('user tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerUserTools(server, mockClient));
  });

  describe('resy_get_profile', () => {
    it('calls GET /2/user and returns a sanitised profile', async () => {
      mockRequest.mockResolvedValue({
        first_name: 'Chris',
        last_name: 'Chall',
        em_address: 'chris@example.com',
        mobile_number: '+15551234567',
        num_bookings: 42,
        date_created: '2020-01-15',
        resy_select: false,
        profile_image_url: 'https://...',
        payment_methods: [{ id: 99, brand: 'visa' }], // should be stripped
      });

      const result = await harness.callTool('resy_get_profile');

      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"first_name": "Chris"');
      expect(text).toContain('"email": "chris@example.com"');
      expect(text).toContain('"phone": "+15551234567"');
      expect(text).not.toContain('payment_methods');
    });
  });
});
