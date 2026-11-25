-- New addresses use province + ward; retain district for legacy branch addresses.
ALTER TABLE "branches" ALTER COLUMN "district" DROP NOT NULL;
