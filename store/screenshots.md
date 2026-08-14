# Chrome Web Store — Required Screenshots

## Required Assets
- 1280x800 or 640x400 screenshots (at least 1, up to 5)
- Small tile: 440x280 PNG
- Large tile (optional): 920x680 PNG  
- Marquee image: 1400x560 PNG

## Recommended Screenshot Sequence

### Screenshot 1: Popup — Safe State
Show the popup open on a verified safe site (e.g., google.com)
- Green shield icon
- "Verified Secure" title
- All stats showing
- Detection Signals panel visible

### Screenshot 2: Popup — Phishing Detected
Show the popup open on a phishing fixture
- Red shield icon
- "Phishing Risk!" title
- "Impersonating: PayPal Login (89.1% match)"
- X-Ray and ML signals shown

### Screenshot 3: Ghost Mask Offer
Show the Ghost Mask offer banner above an email input field
- The purple "🔮 Ghost Form: Unverified site" banner
- "Use Mask" and "No thanks" buttons

### Screenshot 4: Fine-Print AI Banner
Show the Fine-Print AI warning banner at bottom of page
- Dark pattern findings listed (recurring subscription, data sale)
- Severity badges

### Screenshot 5: Options Page
Show the options/settings page
- Whitelist management
- Ghost Masks Pro API key field
- Protection toggle

## How to Capture
1. Run `npm run build` and load the extension unpacked
2. Open Chrome DevTools → More tools → Screenshots for precise 1280x800 capture
3. Or use `playwright screenshot` from tests for automated capture
