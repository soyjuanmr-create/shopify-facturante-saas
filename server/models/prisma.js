require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
console.log('Prisma connecting to DB starting with:', dbUrl ? dbUrl.substring(0, 40) : 'UNDEFINED');

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: dbUrl,
        },
    },
});

module.exports = prisma;
