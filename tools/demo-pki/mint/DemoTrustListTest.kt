package org.multipaz.mpzpass

// Throwaway jvmTest: build the demo trust lists a Multipaz wallet/verifier can load.
//   utopia.vical — signed VICAL wrapping the demo IACA (issuer trust)
//   utopia.rical — signed RICAL wrapping the demo reader cert (reader trust)
// Both are COSE_Sign1-signed by the demo trust-list signer (tools/demo-pki/certs/
// list-signer-cert.pem + keys/list-signer-key.pem). Wraps the SAME IACA that
// signed the minted credentials, so do NOT re-run gen-pki.sh between mint and this.
//
// COPY of tools/demo-pki/mint/DemoTrustListTest.kt. Run:
//   cd ~/tools/git/multipaz && ./gradlew :multipaz:jvmTest \
//       --tests "org.multipaz.mpzpass.DemoTrustListTest" --rerun-tasks

import kotlinx.coroutines.test.runTest
import org.multipaz.crypto.AsymmetricKey
import org.multipaz.crypto.EcPrivateKey
import org.multipaz.crypto.X509Cert
import org.multipaz.crypto.X509CertChain
import org.multipaz.mdoc.rical.Rical
import org.multipaz.mdoc.rical.RicalCertificateInfo
import org.multipaz.mdoc.rical.SignedRical
import org.multipaz.mdoc.vical.SignedVical
import org.multipaz.mdoc.vical.Vical
import org.multipaz.mdoc.vical.VicalCertificateInfo
import org.multipaz.util.truncateToWholeSeconds
import java.io.File
import kotlin.test.Test
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days

class DemoTrustListTest {

    private val DEMO_PKI = "/Users/diegozuluaga/tools/git/attestomcp-demo-pki/tools/demo-pki"
    private val CERTS = "$DEMO_PKI/certs"
    private val KEYS = "$DEMO_PKI/keys"
    private val OUT = "$DEMO_PKI/out"

    // doctypes the demo IACA is authorized to issue (all four demo credentials)
    private val DEMO_DOCTYPES = listOf(
        "org.iso.18013.5.1.mDL",
        "org.multipaz.loyalty.1",
        "org.multipaz.payment.sca.1",
        "org.example.license.1",
    )

    private fun loadSigner(): AsymmetricKey.X509CertifiedExplicit {
        val cert = X509Cert.fromPem(File("$CERTS/list-signer-cert.pem").readText())
        val priv = EcPrivateKey.fromPem(File("$KEYS/list-signer-key.pem").readText(), cert.ecPublicKey)
        return AsymmetricKey.X509CertifiedExplicit(X509CertChain(listOf(cert)), priv)
    }

    @Test
    fun buildTrustLists() = runTest {
        val signer = loadSigner()
        val iacaCert = X509Cert.fromPem(File("$CERTS/iaca-cert.pem").readText())
        val readerCert = X509Cert.fromPem(File("$CERTS/reader-cert.pem").readText())
        val now = Clock.System.now().truncateToWholeSeconds()

        // ---- VICAL: trust the demo IACA as issuer for all four doctypes ----
        val signedVical = SignedVical(
            vical = Vical(
                version = "1.0",
                vicalProvider = "Utopia Demo VICAL Provider",
                date = now,
                nextUpdate = now + 365.days,
                notAfter = now + 365.days,
                vicalIssueID = 1L,
                certificateInfos = listOf(
                    VicalCertificateInfo(
                        certificate = iacaCert,
                        docTypes = DEMO_DOCTYPES,
                        issuingAuthority = "Utopia Demo IACA",
                        issuingCountry = "US",
                    ),
                ),
                vicalUrl = null,
                extensions = emptyMap(),
            ),
            vicalProviderCertificateChain = signer.certChain,
        )
        val vicalBytes = signedVical.generate(signingKey = signer)
        File("$OUT/utopia.vical").writeBytes(vicalBytes)
        println("WROTE utopia.vical (${vicalBytes.size} bytes)")

        // ---- RICAL: trust the demo reader cert as a verifier ----
        val signedRical = SignedRical(
            rical = Rical(
                type = Rical.RICAL_TYPE_READER_AUTHENTICATION,
                version = "1.0",
                provider = "Utopia Demo RICAL Provider",
                date = now,
                nextUpdate = now + 365.days,
                notAfter = now + 365.days,
                certificateInfos = listOf(
                    RicalCertificateInfo(
                        certificate = readerCert,
                        name = "Utopia Demo Reader",
                        issuingCountry = "US",
                    ),
                ),
                id = 1L,
                latestRicalUrl = null,
                extensions = emptyMap(),
            ),
            ricalProviderCertificateChain = signer.certChain,
        )
        val ricalBytes = signedRical.generate(signingKey = signer)
        File("$OUT/utopia.rical").writeBytes(ricalBytes)
        println("WROTE utopia.rical (${ricalBytes.size} bytes)")

        // round-trip parse to confirm they decode + signature verifies
        val v = SignedVical.parse(vicalBytes)
        val r = SignedRical.parse(ricalBytes)
        println("VICAL provider=${v.vical.vicalProvider} certs=${v.vical.certificateInfos.size}")
        println("RICAL provider=${r.rical.provider} certs=${r.rical.certificateInfos.size}")
    }
}
