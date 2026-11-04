pragma circom 2.1.8;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";

// Sparse Merkle tree convention: an empty leaf is zero; a sanctioned address
// has a nonzero leaf. The path is the leaf-to-root path and index bits are
// derived from userAddressHash, so a prover cannot choose another key.
template IdentityVerifier(DEPTH) {
    signal input currentYear;
    signal input minAge;
    signal input sanctionsMerkleRoot;
    signal input issuerPublicKey;
    signal input userAddressHash;

    signal input userBirthYear;
    signal input userSecret;
    signal input sanctionsListMerklePath[DEPTH];
    signal input signature[3]; // EdDSA-Poseidon R8x, R8y, S

    component birthBits = Num2Bits(16);
    birthBits.in <== userBirthYear;
    component yearBits = Num2Bits(16);
    yearBits.in <== currentYear;
    component minBits = Num2Bits(8);
    minBits.in <== minAge;
    component ageCmp = LessThan(17);
    ageCmp.in[0] <== userBirthYear + minAge;
    ageCmp.in[1] <== currentYear + 1;
    ageCmp.out === 1;

    // Secret is bound to the address commitment in the signed attributes.
    component addressCommitment = Poseidon(2);
    addressCommitment.inputs[0] <== userAddressHash;
    addressCommitment.inputs[1] <== userSecret;

    // Signed message binds address, birth year, and secret commitment.
    component attrs = Poseidon(4);
    attrs.inputs[0] <== userAddressHash;
    attrs.inputs[1] <== userBirthYear;
    attrs.inputs[2] <== addressCommitment.out;
    attrs.inputs[3] <== currentYear;
    signal input issuerPublicKeyX;
    signal input issuerPublicKeyY;
    component issuerKeyHash = Poseidon(2);
    issuerKeyHash.inputs[0] <== issuerPublicKeyX;
    issuerKeyHash.inputs[1] <== issuerPublicKeyY;
    issuerKeyHash.out === issuerPublicKey;
    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== issuerPublicKeyX;
    sig.Ay <== issuerPublicKeyY;
    sig.S <== signature[2];
    sig.R8x <== signature[0];
    sig.R8y <== signature[1];
    sig.M <== attrs.out;

    // Sparse-tree inclusion of zero proves non-membership.
    signal nodes[DEPTH + 1];
    signal leftNodes[DEPTH];
    signal rightNodes[DEPTH];
    component pathHash[DEPTH];
    component addressBits = Num2Bits(DEPTH);
    addressBits.in <== userAddressHash;
    nodes[0] <== 0;
    for (var i = 0; i < DEPTH; i++) {
        pathHash[i] = Poseidon(2);
        leftNodes[i] <== nodes[i] + addressBits.out[i] * (sanctionsListMerklePath[i] - nodes[i]);
        rightNodes[i] <== sanctionsListMerklePath[i] + addressBits.out[i] * (nodes[i] - sanctionsListMerklePath[i]);
        pathHash[i].inputs[0] <== leftNodes[i];
        pathHash[i].inputs[1] <== rightNodes[i];
        nodes[i + 1] <== pathHash[i].out;
    }
    nodes[DEPTH] === sanctionsMerkleRoot;
}

component main {public [currentYear, minAge, sanctionsMerkleRoot, issuerPublicKey, userAddressHash]} = IdentityVerifier(248);
