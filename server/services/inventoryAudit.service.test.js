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

test("removes rich Diesel USA signatures and confidentiality notices", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "This part is no longer available. Our notes indicate that we listed this part as",
        "obsolete back in 2021.",
        "",
        "Sorry for the inconvenience. Thank you!",
        "",
        "West Coast Customer Service",
        "Diesel USA",
        "[https://example.com/logo.png]https://www.dieselusa.com/",
        "www.dieselusa.com [https://www.dieselusa.com/]",
        "[tel:866-887-2648]",
        "saleswest@dieselusa.com",
        "",
        "A 100% Associate-Owned Company of Jasper Holdings, Inc.",
        "",
        "CONFIDENTIALITY NOTICE: This email is confidential."
      ].join("\n")
    ),
    [
      "This part is no longer available. Our notes indicate that we listed this part as",
      "obsolete back in 2021.",
      "",
      "Sorry for the inconvenience."
    ].join("\n")
  );
});

test("removes a name followed by a territory manager title", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "3-4 day lead time on this part number from the date it is ordered, as we don’t stock these",
        "completed on the shelf normally.",
        "",
        "Dan Kizmann",
        "USNW/USSW Territory Account Manager"
      ].join("\n")
    ),
    [
      "3-4 day lead time on this part number from the date it is ordered, as we don’t stock these",
      "completed on the shelf normally."
    ].join("\n")
  );
});

test("removes branded Revolution Gear signature blocks", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "Mid next week. You have a few of these on backorder and I will mark them ready to ship as",
        "soon as they come in.",
        "",
        "[PROACTIVE GEARS  Component S Glut ion s]<http://www.proactivegears.com/>",
        "",
        "[VETERAN OWNED AND OPERATED]",
        "",
        "Chris Bradford",
        "Sales / CHA Industries, Inc",
        "403 Joseph Dr. South Elgin, IL 60177"
      ].join("\n")
    ),
    [
      "Mid next week. You have a few of these on backorder and I will mark them ready to ship as",
      "soon as they come in."
    ].join("\n")
  );
});

test("removes short contact signatures and repairs a clipped stock reply", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "In stock and",
        "",
        "Don McMillan",
        "623-907-0081",
        "donm@sbfilters.com",
        "donm@daystarproducts.com",
        "",
        "This email is a service from DayStar Products."
      ].join("\n")
    ),
    "In stock"
  );
});

test("removes a single-name signature before a standalone role", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "I am not aware of them being out of stock at this time",
        "Debra",
        "",
        "*Shipping and Receiving*",
        "*www.cpaddict.com <http://www.cpaddict.com/>*",
        "409-383-6004"
      ].join("\n")
    ),
    "I am not aware of them being out of stock at this time"
  );
});

test("removes Turn 14 sales support signatures and ticket IDs", () => {
  assert.equal(
    _test.stripQuotedReply(
      [
        "Thanks for your patience.",
        "",
        "Part # DR3500 has an ETA of roughly 4 weeks.",
        "",
        "726545:4833579",
        "",
        "Thank you :)",
        "",
        "Christy Nguyen",
        "Sales Support Representative P: 267-468-0350x8100",
        "Turn 14 Distribution"
      ].join("\n"),
      { senderEmail: "support@turn14.com" }
    ),
    "Thanks for your patience.\n\nPart # DR3500 has an ETA of roughly 4 weeks."
  );
});
