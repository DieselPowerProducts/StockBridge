const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("./inventoryAudit.service");

test("collects normalized reply and reference message IDs", () => {
  assert.deepEqual(
    _test.collectMessageIds({
      inReplyTo: "<StockCheck-123@example.com>",
      references: [
        "<older@example.com>",
        "<StockCheck-123@example.com>"
      ]
    }),
    ["stockcheck-123@example.com", "older@example.com"]
  );
});

test("keeps reply text and removes quoted email content", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "We have 12 available and can ship today.",
        "",
        "On Thu, Jul 23, 2026 at 9:00 AM StockBridge wrote:",
        "> Is ABC-123 in stock?",
        "> Thank you!"
      ].join("\r\n")
    ),
    "We have 12 available and can ship today."
  );
});

test("removes Outlook original-message blocks", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "ETA is the first week of August.",
        "",
        "-----Original Message-----",
        "From: StockBridge <stockcheck@example.com>",
        "Sent: Thursday, July 23, 2026",
        "To: Vendor <vendor@example.com>",
        "Subject: Stock Check: ABC-123"
      ].join("\n")
    ),
    "ETA is the first week of August."
  );
});

test("removes inline image placeholders from plain text", () => {
  assert.equal(
    _test.stripQuotedReply("Available now.\n\n[cid:signature-logo@example.com]"),
    "Available now."
  );
});

test("removes greetings and a conventional vendor signature", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "Hello",
        "",
        "ETA is 07/30",
        "",
        "Thank You",
        "",
        "Michael DiSano",
        "Wholesale Sales Rep NW & SW Region",
        "Fox Factory - Perris",
        "1-800-637-3303 ext 0146",
        "[signature_1875131674]"
      ].join("\n")
    ),
    "ETA is 07/30"
  );
});

test("cleans flattened Turn 14 ticket replies", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "726545:4834984     Good day team,     Thank you for reaching out!",
        "I'm looking into this ETA for you and will be in touch once we have an update.",
        "If you have any questions in the meantime, please let me know!",
        "Thank you,   Sam Shock  Customer Support Representative",
        "P: 267-468-0350 x8100",
        "This e-mail message is being sent solely for use by the intended recipient(s).",
        "",
        "On",
        "Thu, Jul 23 at 6:08 PM, Stockcheck <stockcheck@example.com> wrote:",
        "Hello Do you currently have an ETA for part AM-15199?"
      ].join("     "),
      { senderEmail: "support@turn14.com" }
    ),
    "I'm looking into this ETA for you and will be in touch once we have an update."
  );
});

test("removes Outlook signatures, disclaimers, and the original request", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "Good afternoon,",
        "",
        "We are expecting stock within two weeks.",
        "",
        "Respectfully,",
        "",
        "Samantha Pang",
        "Data Entry Specialist",
        "This email and any files transmitted with it are confidential.",
        "________________________________",
        "From: Stock Check <stockcheck@example.com>",
        "Sent: Tuesday, July 21, 2026",
        "Subject: Stock Check : PPE-215022010"
      ].join("\n")
    ),
    "We are expecting stock within two weeks."
  );
});

test("keeps the useful portion of Gmail replies with signatures", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "Hi,",
        "",
        "SD-CAI-6.4 is currently available",
        "",
        "Thanks,",
        "",
        "phone# (916)-772-9253",
        "EXT-242",
        "",
        "On Wed, Jul 22, 2026 at 4:35 PM Stock Check wrote:",
        "> Is SD-CAI-6.4 in stock?"
      ].join("\n")
    ),
    "SD-CAI-6.4 is currently available"
  );
});

test("condenses automated support acknowledgements", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "##- Please type your reply above this line -##",
        "",
        "Your request (5543830) has been received and is being reviewed by our support staff.",
        "",
        "If this is an Urgent Request please call 888-497-3666.",
        "",
        "We look forward to working with you shortly!",
        "",
        "[ZNMJ6M-Z0Z2K]"
      ].join("\n")
    ),
    "Request 5543830 has been received and is being reviewed."
  );
});

test("keeps only the response from updated support tickets", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "Your request (5543823) has been updated. To add additional comments, reply to this email.",
        "----------------------------------------------",
        "",
        "Sadie M., Jul 23, 2026, 4:33 PM MDT",
        "",
        "Part is currently on back order, no current ETA at this time. Thank you!",
        "",
        "We appreciate doing business with you!"
      ].join("\n")
    ),
    "Part is currently on back order, no current ETA at this time."
  );
});
