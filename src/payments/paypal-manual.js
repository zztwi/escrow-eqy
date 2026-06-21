function depositInstructions({ trade, paypalVaultEmail }) {
  const total = trade.amount + trade.fee;
  return [
    `Send ${total.toFixed(2)} ${trade.currency} to PayPal: ${paypalVaultEmail}`,
    `Payment note: ${trade.ticket_id}`,
    "After payment, use /escrow deposit with the PayPal transaction ID.",
    "Staff will manually confirm the funds."
  ].join("\n");
}

function payoutInstructions({ trade }) {
  const sellerReceives = trade.amount;
  return [
    `Send ${sellerReceives.toFixed(2)} ${trade.currency} to the seller.`,
    `Service fee kept: ${trade.fee.toFixed(2)} ${trade.currency}.`,
    "After payout, use /escrow confirm_payout with the PayPal payout ID."
  ].join("\n");
}

module.exports = { depositInstructions, payoutInstructions };
