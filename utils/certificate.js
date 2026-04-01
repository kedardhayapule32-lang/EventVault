const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate a PDF certificate and return it as a buffer
 * @param {Object} data - { name, eventTitle, eventDate, type, roleName, category, semester, branch, place, achievement, academicYear }
 * @returns {Promise<Buffer>}
 */
function generateCertificatePDF(data) {
  // Check if it's the specific Topper category
  const isTopper = data.category && (
    data.category.includes('Academics') && data.category.includes('Toppers')
  );

  if (isTopper) {
    return generateTopperCertificatePDF(data);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 0
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });
    doc.on('error', reject);

    // --- Background/Border ---
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f5f0e8');
    
    // Outer Border
    doc.rect(40, 40, doc.page.width - 80, doc.page.height - 80)
       .lineWidth(3)
       .stroke('#2c3e7a');
    
    // Inner Border
    doc.rect(50, 50, doc.page.width - 100, doc.page.height - 100)
       .lineWidth(1)
       .stroke('#b8a060');

    // --- Content ---
    const centerX = doc.page.width / 2;

    // College Header (Lowered and expanded to 3 lines)
    const headerStartY = 55;

    // B.V.V. Sangha's - Brown and Bold
    doc.fillColor('#6e2c00') 
       .font('Helvetica-Bold')
       .fontSize(14)
       .text("B. V. V. Sangha's", 0, headerStartY, { align: 'center' });
    
    // Institute Name - Red and Bold
    doc.fillColor('#b71c1c')
       .font('Helvetica-Bold')
       .fontSize(20)
       .text('BILURU GURUBASAVA MAHASWAMIJI INSTITUTE', 0, headerStartY + 25, { align: 'center' });

    // Technology + Location - Red and Bold
    doc.fontSize(20)
       .text('OF TECHNOLOGY, MUDHOL-587313', 0, headerStartY + 52, { align: 'center' });

    // Affiliation Line
    doc.fillColor('#000000')
       .font('Helvetica')
       .fontSize(11)
       .text('Affiliated to Visvesvaraya Technological University, Belagavi', 0, headerStartY + 82, { align: 'center' });

    // Organization Name (Shifted Down)
    doc.font('Helvetica')
       .fillColor('#b8a060')
       .fontSize(10)
       .text('EVENTVAULT', 0, headerStartY + 110, { align: 'center', characterSpacing: 4 });

    // Certificate Title (Shifted Down)
    let certType = 'Participation';
    if (data.type === 'volunteer') certType = 'Volunteering';
    if (data.type === 'achievement') certType = 'Achievement';

    doc.fillColor('#2c3e7a')
       .fontSize(14)
       .text(`CERTIFICATE OF ${certType.toUpperCase()}`, 0, headerStartY + 130, { align: 'center', characterSpacing: 2 });

    // Logos 
    const logo1Path = path.join(__dirname, '..', 'logo_right_new.jpg');
    const logo2Path = path.join(__dirname, '..', 'logo1.png');
    const stickerLeftPath = path.join(__dirname, '..', 'sticker_left.png');
    const stickerRightPath = path.join(__dirname, '..', 'sticker_right.png');

    if (fs.existsSync(logo2Path)) {
        doc.image(logo2Path, 60, 60, { width: 70 });
    }

    if (fs.existsSync(stickerLeftPath)) {
        doc.image(stickerLeftPath, 60, 60, { width: 80 });
    }

    if (fs.existsSync(stickerRightPath)) {
        doc.image(stickerRightPath, doc.page.width - 140, 60, { width: 80 });
    } else if (fs.existsSync(logo1Path)) {
        doc.image(logo1Path, doc.page.width - 140, 60, { width: 80 });
    }
    
    // --- USER PHOTO ---
    const maxPhotoWidth = 105;
    const maxPhotoHeight = 135;
    const photoY = headerStartY + 160; 

    if (data.photo) {
      try {
        let photoInput = data.photo;
        if (typeof data.photo === 'string' && data.photo.startsWith('data:image/')) {
          const base64Data = data.photo.split(';base64,').pop();
          photoInput = Buffer.from(base64Data, 'base64');
        }
        
        // Open the image to get its actual dimensions
        const img = doc.openImage(photoInput);
        const scale = Math.min(maxPhotoWidth / img.width, maxPhotoHeight / img.height);
        const actualWidth = img.width * scale;
        const actualHeight = img.height * scale;
        const actualX = (doc.page.width - actualWidth) / 2;

        // Draw frame around the actual photo dimensions
        doc.rect(actualX - 4, photoY - 4, actualWidth + 8, actualHeight + 8)
           .lineWidth(1.5)
           .stroke('#b8a060');

        doc.image(photoInput, actualX, photoY, { width: actualWidth, height: actualHeight });
      } catch (e) {
        console.error('Failed to embed photo in PDF:', e.message);
      }
    }
    
    // Adjust next content start position based on max possible height
    const startContentY = photoY + maxPhotoHeight + 15; 

    // Subtitle
    doc.fillColor('#999999')
       .font('Helvetica')
       .fontSize(12)
       .text(data.type === 'achievement' ? 'Awarded to' : '', 0, startContentY, { align: 'center' });

    // Person Name
    doc.fillColor('#1a2050')
       .fontSize(36)
       .text(data.name, 0, startContentY + 10, { align: 'center' });

    // USN / Branch Info
    if (data.usn || data.roleName) {
      let infoText = '';
      if (data.usn) infoText += `USN: ${data.usn}`;
      if (data.roleName && data.type === 'achievement') {
        infoText += (infoText ? '  |  ' : '') + data.roleName;
      }
      
      if (infoText) {
        doc.fillColor('#444444')
           .fontSize(14)
           .text(infoText, 0, startContentY + 50, { align: 'center' });
      }
    }

    // Body text
    let actionText = '';
    if (data.type === 'volunteer') {
      actionText = `has successfully volunteered as ${data.roleName || 'Volunteer'}`;
    } else if (data.type === 'achievement') {
      actionText = 'for outstanding performance and achievement in';
    } else {
      actionText = 'has successfully participated';
    }
    
    doc.fillColor('#444444')
       .fontSize(14)
       .text(actionText, 0, startContentY + 75, { align: 'center' })
       .text(data.type === 'achievement' ? '' : 'at', { align: 'center' });

    // Event Title / Category
    doc.fillColor('#2c3e7a')
       .fontSize(22)
       .text(data.eventTitle, 0, startContentY + 110, { align: 'center', oblique: true });

    // Date / Academic Year
    doc.fillColor('#888888')
       .fontSize(11)
       .text(`${data.type === 'achievement' ? 'Year' : 'on'} ${data.eventDate}`, 0, startContentY + 140, { align: 'center' });

    // --- Signatures & Seal ---
    const sigY = 510;
    doc.moveTo(100, sigY).lineTo(260, sigY).lineWidth(1).stroke('#333333');
    doc.fillColor('#666666').fontSize(12).text('Event Organizer', 100, sigY + 10, { width: 160, align: 'center' });

    const today = new Date().toLocaleDateString('en-IN');
    doc.moveTo(doc.page.width - 260, sigY).lineTo(doc.page.width - 100, sigY).lineWidth(1).stroke('#333333');
    doc.fillColor('#666666').fontSize(12).text(`Date: ${today}`, doc.page.width - 260, sigY + 10, { width: 160, align: 'center' });

    doc.end();
  });
}

/**
 * Specifically for Academic Toppers Template
 */
function generateTopperCertificatePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 0
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });
    doc.on('error', reject);

    // Register Fonts
    const blackletterPath = path.join(__dirname, '..', 'blackletter.ttf');
    const elegantPath = path.join(__dirname, '..', 'elegant.ttf');
    
    let titleFont = 'Helvetica-Bold';
    let bodyFont = 'Helvetica';

    try {
      if (fs.existsSync(blackletterPath)) {
          doc.registerFont('blackletter', blackletterPath);
          titleFont = 'blackletter';
      }
    } catch (e) {
      console.warn('Warning: Failed to register blackletter font:', e.message);
    }

    try {
      if (fs.existsSync(elegantPath)) {
          doc.registerFont('elegant', elegantPath);
          bodyFont = 'elegant';
      }
    } catch (e) {
      console.warn('Warning: Failed to register elegant font:', e.message);
    }

    try {
      doc.font(titleFont);
    } catch (e) {
      titleFont = 'Helvetica-Bold';
    }

    try {
      doc.font(bodyFont);
    } catch (e) {
      bodyFont = 'Helvetica';
    }

    const mainBlue = '#2c3e7a';
    const mainRed = '#b71c1c';
    const goldColor = '#c5a059';
    const textGray = '#333333';
    const bgCream = '#fdfcf0';

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(bgCream);

    const bgImgPath = path.join(__dirname, '..', 'comedk_bg.jpg');
    if (fs.existsSync(bgImgPath)) {
      doc.save();
      doc.opacity(0.25);
      doc.image(bgImgPath, 50, 50, { 
        width: doc.page.width - 100,
        height: doc.page.height - 100,
        align: 'center',
        valign: 'center'
      });
      doc.restore();
    }

    doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30)
       .lineWidth(1.5)
       .stroke(mainBlue);
    
    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40)
       .lineWidth(0.5)
       .stroke(mainBlue);

    const logo1Path = path.join(__dirname, '..', 'logo_right_new.jpg');
    const logo2Path = path.join(__dirname, '..', 'logo1.png');

    if (fs.existsSync(logo2Path)) {
        doc.image(logo2Path, 45, 45, { width: 60 });
    }
    
    const photoWidth = 105;
    const photoHeight = 135;
    const photoX = (doc.page.width - photoWidth) / 2;
    const photoY = 240; 

    if (data.photo) {
      try {
        let photoInput = data.photo;
        if (typeof data.photo === 'string' && data.photo.startsWith('data:image/')) {
          const base64Data = data.photo.split(';base64,').pop();
          photoInput = Buffer.from(base64Data, 'base64');
        }
        doc.rect(photoX - 5, photoY - 5, photoWidth + 10, photoHeight + 10).lineWidth(2).stroke(mainBlue);
        doc.image(photoInput, photoX, photoY, { width: photoWidth, height: photoHeight, fit: [photoWidth, photoHeight] });
      } catch (e) {
        if (fs.existsSync(logo1Path)) doc.image(logo1Path, photoX, photoY, { width: 100 });
      }
    } else if (fs.existsSync(logo1Path)) {
        doc.image(logo1Path, photoX, photoY, { width: 100 });
    }

    doc.fillColor(textGray).fontSize(16).font(bodyFont).text("B. V. V. Sangha's", 0, 40, { align: 'center' });
    doc.fillColor(mainRed).fontSize(22).font(titleFont).text('BILURU GURUBASAVA MAHASWAMIJI INSTITUTE', 0, 65, { align: 'center' }).text('OF TECHNOLOGY, MUDHOL-587 313', 0, 95, { align: 'center' });
    doc.fillColor('#000000').fontSize(10).font(bodyFont).text('(Approved by AICTE, New Delhi & Affiliated to Visvesvaraya Technological University, Belagavi, Karnataka)', 0, 130, { align: 'center' });
    doc.fillColor(mainBlue).fontSize(44).font(titleFont).text('SIDDHISOPANAM-2026', 0, 170, { align: 'center' });
    
    const titleWidth = doc.widthOfString('SIDDHISOPANAM-2026');
    doc.moveTo(doc.page.width/2 - titleWidth/2 - 20, 215).lineTo(doc.page.width/2 + titleWidth/2 + 20, 215).lineWidth(2).stroke(mainBlue);
    doc.fillColor('#6e2c00').fontSize(32).font(titleFont).text('CERTIFICATE', 0, 245, { align: 'center', characterSpacing: 4 });

    const startY = photoY + photoHeight + 35;
    const contentMargin = 80;
    const rightMargin = doc.page.width - 80;
    const lineGap = 40;
    const bodyFontSize = 18;

    doc.fillColor(textGray).fontSize(bodyFontSize).font(bodyFont);
    doc.text('This is to certify that Mr./Miss.', contentMargin, startY);
    const line1LabelWidth = doc.widthOfString('This is to certify that Mr./Miss. ');
    doc.moveTo(contentMargin + line1LabelWidth, startY + 18).lineTo(rightMargin, startY + 18).lineWidth(1).stroke(textGray);
    doc.font(bodyFont).fillColor('#000000').text(data.name || '', contentMargin + line1LabelWidth, startY - 2, { width: rightMargin - (contentMargin + line1LabelWidth), align: 'center' });

    const line2Y = startY + lineGap;
    doc.font(bodyFont).fillColor(textGray).text('of', contentMargin, line2Y);
    const semX = contentMargin + doc.widthOfString('of ');
    doc.moveTo(semX, line2Y + 18).lineTo(semX + 80, line2Y + 18).stroke();
    doc.font(bodyFont).fillColor('#000000').text(data.semester || '', semX, line2Y - 2, { width: 80, align: 'center' });
    doc.font(bodyFont).fillColor(textGray).text('Semester,', semX + 85, line2Y);
    const branchX = semX + 85 + doc.widthOfString('Semester, ');
    doc.moveTo(branchX, line2Y + 18).lineTo(branchX + 180, line2Y + 18).stroke();
    doc.font(bodyFont).fillColor('#000000').text(data.branch || '', branchX, line2Y - 2, { width: 180, align: 'center' });
    doc.font(bodyFont).fillColor(textGray).text('Branch, has secured', branchX + 185, line2Y);
    const placeX = branchX + 185 + doc.widthOfString('Branch, has secured ');
    const placeWidth = rightMargin - placeX - doc.widthOfString(' place');
    doc.moveTo(placeX, line2Y + 18).lineTo(placeX + placeWidth, line2Y + 18).stroke();
    doc.font(bodyFont).fillColor('#000000').text(data.place || '', placeX, line2Y - 2, { width: placeWidth, align: 'center' });
    doc.font(bodyFont).fillColor(textGray).text('place', rightMargin - doc.widthOfString('place'), line2Y);

    const line3Y = line2Y + lineGap;
    doc.font(bodyFont).fillColor(textGray).text('in', contentMargin, line3Y);
    const achX = contentMargin + doc.widthOfString('in ');
    doc.moveTo(achX, line3Y + 18).lineTo(achX + 350, line3Y + 18).stroke();
    doc.font(bodyFont).fillColor('#000000').text(data.achievement || '', achX, line3Y - 2, { width: 350, align: 'center' });
    doc.font(bodyFont).fillColor(textGray).text('for the Academic Year', achX + 360, line3Y);
    const yearX = achX + 360 + doc.widthOfString('for the Academic Year ');
    doc.moveTo(yearX, line3Y + 18).lineTo(rightMargin, line3Y + 18).stroke();
    doc.font(bodyFont).fillColor('#000000').text(data.academicYear || '', yearX, line3Y - 2, { width: rightMargin - yearX, align: 'center' });

    const sigY = 540;
    doc.font(bodyFont).fontSize(14).fillColor(textGray);
    doc.text('Academic Co-ordinator', 50, sigY, { width: 250, align: 'center' });
    doc.text('Chief Guest', doc.page.width/2 - 125, sigY, { width: 250, align: 'center' });
    doc.text('Principal', doc.page.width - 300, sigY, { width: 250, align: 'center' });

    doc.end();
  });
}

module.exports = { generateCertificatePDF };
