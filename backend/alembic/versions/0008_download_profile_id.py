"""add profile_id to download_jobs

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'download_jobs',
        sa.Column(
            'profile_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('profiles.id', ondelete='SET NULL'),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column('download_jobs', 'profile_id')
