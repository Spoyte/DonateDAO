import { ContractFactory, Provider, utils, Wallet } from "zksync-web3";
import * as ethers from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { getDeployedContracts } from "zksync-web3/build/src/utils";

require("dotenv").config();

// Put the address of the deployed paymaster and the Greeter Contract in the .env file
const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS;
const EMPTY_WALLET_ADDRESS = process.env.EMPTY_WALLET_ADDRESS;
// value of usdc to send, 18 decimals
const VALUE_TO_SEND = process.env.VALUE_TO_SEND;

// Put the address of the ERC20 token in the .env file:
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

function getToken(hre: HardhatRuntimeEnvironment, wallet: Wallet) {
  const artifact = hre.artifacts.readArtifactSync("MyERC20");
  return new ethers.Contract(TOKEN_ADDRESS, artifact.abi, wallet);
}

// Wallet private key
// ⚠️ Never commit private keys to file tracking history, or your account could be compromised.
const EMPTY_WALLET_PRIVATE_KEY = process.env.EMPTY_WALLET_PRIVATE_KEY;
export default async function (hre: HardhatRuntimeEnvironment) {
    const provider = new Provider("https://testnet.era.zksync.dev");
    const emptyWallet = new Wallet(EMPTY_WALLET_PRIVATE_KEY, provider);//not required, this is to create a wallet
    //can replace emptyWallet by the metamask wallet

  const erc20 = getToken(hre, emptyWallet);

  const gasPrice = await provider.getGasPrice();

  // Loading the Paymaster Contract
  const deployer = new Deployer(hre, emptyWallet);
  const paymasterArtifact = await deployer.loadArtifact("MyPaymaster");

  const PaymasterFactory = new ContractFactory(
    paymasterArtifact.abi,
    paymasterArtifact.bytecode,
    deployer.zkWallet
  );
  const PaymasterContract = PaymasterFactory.attach(PAYMASTER_ADDRESS);

  // Estimate gas fee for the transaction
  const gasLimit = await erc20.estimateGas.transfer(
    EMPTY_WALLET_ADDRESS, //to replace with the adresse of the current erc20
    ethers.BigNumber.from(VALUE_TO_SEND), //value to send in usd 18 decimals
    {
      customData: {
        gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        paymasterParams: utils.getPaymasterParams(PAYMASTER_ADDRESS, {
          type: "ApprovalBased",
          token: TOKEN_ADDRESS,
          // Set a large allowance just for estimation
          minimalAllowance: ethers.BigNumber.from(`100000000000000000000`),
          // Empty bytes as testnet paymaster does not use innerInput
          innerInput: new Uint8Array(),
        }),
      },
    }
  );

  // Gas estimation:
  const fee = gasPrice.mul(gasLimit.toString());

  // Calling the dAPI to get the ETH price:
  const ETHUSD = await PaymasterContract.readDapi(
    "0x28ce555ee7a3daCdC305951974FcbA59F5BdF09b"
  );
  const USDCUSD = await PaymasterContract.readDapi(
    "0x946E3232Cc18E812895A8e83CaE3d0caA241C2AB"
  );

  // Calculating the USD fee:
  const usdFee = fee.mul(ETHUSD).div(USDCUSD);

  // Encoding the "ApprovalBased" paymaster flow's input
  const paymasterParams = utils.getPaymasterParams(PAYMASTER_ADDRESS, {
    type: "ApprovalBased",
    token: TOKEN_ADDRESS,
    // set minimalAllowance to the estimated fee in erc20
    minimalAllowance: ethers.BigNumber.from(usdFee),
    // empty bytes as testnet paymaster does not use innerInput
    innerInput: new Uint8Array(),
  });

  await (
    await erc20
      .connect(emptyWallet)
      .transfer(EMPTY_WALLET_ADDRESS, ethers.BigNumber.from(VALUE_TO_SEND), {
        // specify gas values
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: 0,
        gasLimit: gasLimit,
        // paymaster info
        customData: {
          paymasterParams: paymasterParams,
          gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        },
      })
  ).wait();
}