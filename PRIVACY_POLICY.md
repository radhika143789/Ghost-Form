# Privacy Policy for Ghost Form

**Last Updated:** June 30, 2026

Ghost Form ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how our Chrome Extension collects, uses, and safeguards your information. 

Our core philosophy is **Zero-Knowledge Security**: we believe your data should never leave your device unless absolutely necessary.

## 1. Information We Collect (and Don't Collect)

Ghost Form is designed to prevent data leaks. Therefore, our data collection is strictly minimized:

- **We DO NOT log your keystrokes.**
- **We DO NOT transmit your passwords, credit card numbers, or any personally identifiable information (PII) to our servers or any third party.** 
- **We DO NOT track your browsing history.**

### Data Processed Locally
To function, the extension evaluates the structure of the data you type (e.g., checking if text matches a credit card format) using client-side Regular Expressions. **This evaluation happens entirely on your local machine.** The typed data is immediately discarded from memory and never leaves your browser.

### Data Transmitted
The only data transmitted by Ghost Form is the **hostname (domain name)** of the current website you are visiting (e.g., `example.com`). 
This domain is sent to our secure Cloudflare proxy server exclusively to verify the domain's reputation against our Threat Intelligence API. 

## 2. How We Protect Your Data
Our backend proxy operates as a stateless serverless function. It receives the domain name, queries the threat database, and returns the result to your browser. **It does not log, store, or aggregate the domains you visit.**

## 3. Required Permissions
To provide real-time protection, Ghost Form requires the following browser permissions:
- `activeTab`: To read the URL of the current tab for threat analysis.
- `scripting` (Content Scripts): To inject the visual warning overlays and monitor form fields on potentially dangerous sites.
- `storage`: To save your manual whitelist preferences locally on your device.

## 4. Third-Party Services
We utilize a backend threat intelligence provider to determine domain safety. We only share the requested domain name with this provider. No user identifiers, IP addresses, or typed data are shared.

## 5. Contact Us
If you have any questions or concerns about this Privacy Policy, please contact our support team or open an issue on our public repository.
