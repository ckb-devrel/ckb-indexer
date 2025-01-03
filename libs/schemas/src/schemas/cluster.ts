import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
@Index(["clusterId", "updatedAtHeight"], { unique: true })
export class Cluster {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index()
  clusterId: string;

  @Column({ type: "text" })
  name: string;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "varchar" })
  createTxHash: string;

  @Column({ type: "varchar" })
  creatorAddress: string;

  @Column({ type: "varchar" })
  ownerAddress: string;

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
