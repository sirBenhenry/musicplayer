"""Add data JSON column to user_notifications

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa

revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user_notifications', sa.Column('data', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('user_notifications', 'data')
