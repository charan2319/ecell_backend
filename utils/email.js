const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify connection configuration
transporter.verify(function (error, success) {
  if (error) {
    console.warn("SMTP Server Warning: Emails may not send. Check your .env credentials.");
    console.error(error);
  } else {
    console.log("SMTP Server is ready to take our messages");
  }
});

const sendMagicLink = async (email, link) => {
  const mailOptions = {
    from: `"Founder's Mart Control" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Magic Login Link - Founder\'s Mart',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Welcome to Founder's Mart!</h2>
        <p>You requested a login link. Click the button below to sign in instantly.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}" style="background-color: #FFC700; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Log In to Founder's Mart</a>
        </div>
        <p style="color: #666; font-size: 12px; text-align: center;">This link will expire in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="color: #999; font-size: 10px; text-align: center;">&copy; 2026 Founder's Mart by E-Cell Alliance University</p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
};

const sendOtpEmail = async (email, otp) => {
  const mailOptions = {
    from: `"Founder's Mart Control" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Login OTP - Founder\'s Mart',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Welcome to Founder's Mart!</h2>
        <p style="text-align: center; color: #555;">Use the following 4-digit One-Time Password (OTP) to log in to your account. This OTP is valid for 10 minutes.</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="background-color: #f4f4f4; border: 1px dashed #ccc; color: #333; padding: 15px 30px; border-radius: 8px; font-weight: bold; font-size: 24px; letter-spacing: 4px;">
            ${otp}
          </span>
        </div>
        <p style="color: #666; font-size: 12px; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="color: #999; font-size: 10px; text-align: center;">&copy; 2026 Founder's Mart by E-Cell Alliance University</p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
};

module.exports = { sendMagicLink, sendOtpEmail };
