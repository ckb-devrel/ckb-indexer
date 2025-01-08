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

  @Column({ type: "mediumtext" })
  name: string;

  @Column({ type: "mediumtext" })
  description: string;

  @Column({ type: "varchar" })
  createTxHash: string;

  @Column({ type: "mediumtext" })
  creatorAddress: string;

  @Column({ type: "mediumtext" })
  ownerAddress: string;

  // To roll back on re-org
  @Column({ type: "varchar" })
  @Index()
  updatedAtHeight: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
