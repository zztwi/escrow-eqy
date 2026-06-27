const blockedTerms = [
  "alcool",
  "alcol",
  "beer",
  "vino",
  "gambling",
  "casino",
  "scommessa",
  "betting",
  "interest",
  "interesse",
  "loan interest",
  "riba",
  "porn",
  "adult",
  "droga",
  "weapon"
];

function validateDescription(description) {
  const normalized = description.toLowerCase();
  const matched = blockedTerms.filter((term) => normalized.includes(term));
  return {
    allowed: matched.length === 0,
    matched
  };
}

module.exports = { validateDescription };
