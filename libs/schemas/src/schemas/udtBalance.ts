import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
@Index(["addressHash", "tokenHash"], { unique: true })
export class UdtBalance {
  @PrimaryGeneratedColumn("increment")
  id: number;

  @Column({ type: "varchar" })
  @Index()
  addressHash: string;

  @Column({ type: "varchar" })
  @Index()
  tokenHash: string;

  @Column({ type: "text" })
  address: string;

  /* === Statistic fields === */
  @Column({ type: "varchar" })
  capacity: string;

  @Column({ type: "varchar" })
  balance: string;
  /* === Statistic fields === */

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity()
export class UdtBalancePending extends UdtBalance {}
