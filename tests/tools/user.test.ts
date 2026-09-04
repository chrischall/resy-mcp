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
      expect(text).toContain('"first_name":"Chris"');
      expect(text).toContain('"email":"chris@example.com"');
      expect(text).toContain('"phone":"+15551234567"');
      expect(text).not.toContain('payment_methods');
    });

    // `profile_image_url` is the ONE media URL any read tool in this server
    // returns, so this tool is the only place compact strips anything real.
    // It shipped without the `view` wiring once, which made the whole feature
    // a no-op across the server — hence a test at the TOOL boundary and not
    // just on the helper.
    const withAvatar = {
      first_name: 'Chris',
      em_address: 'chris@example.com',
      date_created: '2020-01-15',
      profile_image_url: 'https://images.resy.com/avatars/1234',
    };

    it('strips profile_image_url by DEFAULT — compact is what a caller gets unasked', async () => {
      mockRequest.mockResolvedValue(withAvatar);
      const result = await harness.callTool('resy_get_profile');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.profile_image_url).toBeUndefined();
      // Subtractive, so everything that is not a picture is still here.
      expect(parsed.first_name).toBe('Chris');
      expect(parsed.member_since).toBe('2020-01-15');
    });

    it('returns profile_image_url on view: "full"', async () => {
      mockRequest.mockResolvedValue(withAvatar);
      const result = await harness.callTool('resy_get_profile', { view: 'full' });
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.profile_image_url).toBe('https://images.resy.com/avatars/1234');
    });

    it('emits a single line — no pretty-printing on either rung', async () => {
      for (const args of [undefined, { view: 'full' }]) {
        mockRequest.mockResolvedValue(withAvatar);
        const result = await harness.callTool('resy_get_profile', args);
        expect((result.content[0] as { text: string }).text.includes('\n')).toBe(false);
      }
    });

    // `view` is a RESPONSE-shape argument; Resy has never heard of it. Two
    // sibling repos shipped a handler that forwarded its whole args object
    // into a query string and sent `view=compact` to the live API.
    it('never forwards `view` upstream', async () => {
      mockRequest.mockResolvedValue(withAvatar);
      await harness.callTool('resy_get_profile', { view: 'full' });
      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(mockRequest.mock.calls[0]).toHaveLength(2);
    });
  });

  describe('resy_list_payment_methods', () => {
    it('calls GET /2/user and returns only payment-method fields', async () => {
      mockRequest.mockResolvedValue({
        first_name: 'Chris',
        em_address: 'chris@example.com',
        payment_methods: [
          { id: 55, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, is_default: true },
          { id: 77, brand: 'amex', display_number: '1001', exp_month: 3, exp_year: 2029 },
        ],
      });

      const result = await harness.callTool('resy_list_payment_methods');

      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        id: 55, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, is_default: true,
      });
      expect(parsed[1]).toEqual({
        id: 77, brand: 'amex', last_four: '1001', exp_month: 3, exp_year: 2029, is_default: false,
      });
      // Should not leak other user fields
      expect(text).not.toContain('chris@example.com');
      expect(text).not.toContain('first_name');
    });

    it('returns an empty array when user has no payment methods', async () => {
      mockRequest.mockResolvedValue({ first_name: 'Chris' });
      const result = await harness.callTool('resy_list_payment_methods');
      const text = (result.content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual([]);
    });

    // A card is not a picture: this projection has no media field at all, so
    // compact and full must agree byte for byte. Pinned because a `view` that
    // quietly changed a payment method would be far worse than one that did
    // nothing — and because `view` must not reach Resy either way.
    it('answers identically on compact and full, and never forwards `view`', async () => {
      const raw = { payment_methods: [{ id: 55, brand: 'visa', last_four: '4242' }] };
      mockRequest.mockResolvedValue(raw);
      const compact = (await harness.callTool('resy_list_payment_methods')).content[0] as { text: string };
      mockRequest.mockResolvedValue(raw);
      const full = (await harness.callTool('resy_list_payment_methods', { view: 'full' })).content[0] as { text: string };
      expect(compact.text).toBe(full.text);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(mockRequest.mock.calls.every((c) => c.length === 2)).toBe(true);
    });
  });
});
