import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SPECIALTY_IMAGES = {
  'tim-mach': {
    standard: 'https://images.unsplash.com/photo-1628348068343-c6a848d2b6dd?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&auto=format&fit=crop&q=80',
  },
  'tieu-hoa-gan-mat': {
    standard: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&auto=format&fit=crop&q=80',
  },
  'da-lieu': {
    standard: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1629909615184-74f495363b67?w=800&auto=format&fit=crop&q=80',
  },
  'ho-hap': {
    standard: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80',
  },
  'mat': {
    standard: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=800&auto=format&fit=crop&q=80',
  },
  'tai-mui-hong': {
    standard: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&auto=format&fit=crop&q=80',
  },
  'rang-ham-mat': {
    standard: 'https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=800&auto=format&fit=crop&q=80',
  },
  'san-phu-khoa': {
    standard: 'https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1629909615184-74f495363b67?w=800&auto=format&fit=crop&q=80',
  },
  'nhi-khoa': {
    standard: 'https://images.unsplash.com/photo-1631815589968-fdb09a223b1e?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80',
  },
  'ngoai-chan-thuong-chinh-hinh': {
    standard: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=800&auto=format&fit=crop&q=80',
  },
  'noi-tong-quat': {
    standard: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80',
    after: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
    followup: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=800&auto=format&fit=crop&q=80',
    advice: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
  },
};

SPECIALTY_IMAGES.tim_mach = SPECIALTY_IMAGES['tim-mach'];
SPECIALTY_IMAGES.tieu_hoa = SPECIALTY_IMAGES['tieu-hoa-gan-mat'];
SPECIALTY_IMAGES.da_lieu = SPECIALTY_IMAGES['da-lieu'];
SPECIALTY_IMAGES.ho_hap = SPECIALTY_IMAGES['ho-hap'];
SPECIALTY_IMAGES.co_xuong_khop = SPECIALTY_IMAGES['ngoai-chan-thuong-chinh-hinh'];
SPECIALTY_IMAGES.nhi_khoa = SPECIALTY_IMAGES['nhi-khoa'];
SPECIALTY_IMAGES.san_phu_khoa = SPECIALTY_IMAGES['san-phu-khoa'];
SPECIALTY_IMAGES.rang_ham_mat = SPECIALTY_IMAGES['rang-ham-mat'];
SPECIALTY_IMAGES.tong_quat = SPECIALTY_IMAGES['noi-tong-quat'];

async function run() {
  console.log('Bắt đầu cập nhật imageUrl cho toàn bộ packages trong database...');
  const packages = await prisma.servicePackage.findMany({
    include: { specialty: true },
  });

  let count = 0;
  for (const pkg of packages) {
    const specSlug = pkg.specialty?.slug || 'noi-tong-quat';
    const mapping = SPECIALTY_IMAGES[specSlug] || SPECIALTY_IMAGES['noi-tong-quat'];
    const code = pkg.code || '';

    let newImageUrl = pkg.imageUrl;
    if (!newImageUrl) {
      if (code.endsWith('-STANDARD') || code.includes('STANDARD')) {
        newImageUrl = mapping.standard;
      } else if (code.endsWith('-AFTER') || code.includes('AFTER')) {
        newImageUrl = mapping.after;
      } else if (code.endsWith('-FOLLOWUP') || code.includes('FOLLOWUP')) {
        newImageUrl = mapping.followup;
      } else if (code.endsWith('-ADVICE') || code.includes('ADVICE')) {
        newImageUrl = mapping.advice;
      } else {
        newImageUrl = mapping.standard;
      }

      await prisma.servicePackage.update({
        where: { id: pkg.id },
        data: { imageUrl: newImageUrl },
      });
      count++;
    }
  }

  console.log(`Đã cập nhật thành công imageUrl cho ${count} gói khám/dịch vụ!`);
  await prisma.$disconnect();
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
