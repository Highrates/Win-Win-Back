-- Статус «Предложение сформировано» — после «На согласовании», перед «Согласовано».
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PROPOSAL_FORMED' AFTER 'PENDING_APPROVAL';
