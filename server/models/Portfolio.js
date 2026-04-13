const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'Your Name' },
  dob: { type: String, default: '' },
  birthPlace: { type: String, default: '' },
  sector: { type: String, required: true, default: 'Technology' },
  investmentType: { type: String, default: '' },
  initialInvestment: { type: Number, required: true, default: 100000 },
  currentValue: { type: Number, required: true, default: 120000 },
  netGain: { type: Number, required: true, default: 20000 },
  yearlyIncome: { type: [{ year: Number, income: Number }], default: [] },
  energyAssets: { type: String, default: '' },
  estimatedLifetimeEarnings: { type: Number, default: 0 },
  totalWealthGenerated: { type: Number, default: 0 },
  bio: { type: String, default: '' },
  about: { type: String, default: 'This portfolio shows one investor record with current performance numbers and a profile image. Use the admin page to update the details and upload a new profile image.' },
  companyHistory: { type: String, default: '' },
  image: { type: String, required: true, default: '/uploads/image2.jpeg' },
  gallery: { type: [String], default: [] }
}, {
  timestamps: true
});

module.exports = mongoose.model('Portfolio', portfolioSchema);
