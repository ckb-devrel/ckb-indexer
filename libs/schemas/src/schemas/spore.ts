import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
@Index(["sporeId", "updatedAtHeight"], { unique: true })
export class Spore {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index()
  sporeId: string;

  @Column({ type: "varchar", nullable: true })
  clusterId?: string;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "text" })
  contentType: string;

  @Column({ type: "text", nullable: true })
  dobDecoded?: string;

  @Column({ type: "varchar" })
  createTxHash: string;

  @Column({ type: "varchar" })
  creatorAddress: string;

  @Column({ type: "varchar", nullable: true })
  ownerAddress?: string;

  @Column({ type: "int", nullable: true })
  updateFromId?: number;

  // To roll back on re-org
  @Column({ type: "varchar" })
  @Index()
  updatedAtHeight: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
