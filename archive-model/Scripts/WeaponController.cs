using System;
using System.ComponentModel;
using Unity.VisualScripting;
using UnityEngine;


[Serializable]
public class FiringArcSettings
{
    [Range(-360, 360)]
    public float minHorizontalRotationAngle = -90; // minimum yaw

    [Range(-360, 360)]
    public float maxHorizontalRotationAngle = 90; // maximum yaw

    [Range(-360, 360)]
    public float minVerticalRotationAngle = -90;   // minimum pitch

    [Range(-360, 360)]
    public float maxVerticalRotationAngle = 90;   // maximum pitch
}

public class WeaponController: ShipSubsystem
{
    public WeaponData weaponData;
    public Transform originPoint;
    public GameObject shipWeaponModel;

    public override HealthStats SubsystemHealth => healthStats; 


    public HealthStats healthStats;

    public float lastFired = -1;

    [GradientUsage(hdr: true)]
    public Gradient gradient;

    public AttackInformation attackInfoOrder;


    public string weaponName = "Default Weapon";

    [Header("Weapon Arc Settings")]
    public FiringArcSettings firingArcSettings;
    public Transform shotSpawnPoint;
    public Transform cannonCenterPivot;

    public override float HealthPercent => healthStats.Percent;
    public override string HealthDisplayText => $"{healthStats.currentHealth}/{healthStats.startingHealth}";
    public override string SubsystemName => weaponName;

    public override Transform targetLocation => targetPivot;

    public Transform targetPivot;

    [Range(0,100f)]
    public float blockDamagePercent = 75f;

    [Range(.001f,10f)]
    public float damageMultiplier = 1;

    public WeaponIconType weaponIconType;

    public int batchLaunch = 3;
    public bool mouseOver = false;


    public int ammo = -1; // this means its infinite.

    public int mountPoint;

    private void Start()
    {
        lastFired = -1;
    }

    public void Fire(ShipController target, ShipController origin, float fireTime, ShipSubsystem shipSubsystem = null)
    {
        fireTime = Mathf.RoundToInt(fireTime);

        if (target != null && !healthStats.IsDead)
        {
            var targetPosition = shipSubsystem != null ? shipSubsystem.targetLocation : target.transform;

            var firingArcTest = CheckIfWeaponCanFire(
                cannonCenterPivot.position,
                cannonCenterPivot.rotation,
                targetPosition.position);

            if (firingArcTest)
            {

                if (weaponData.weaponFx.weaponType == WeaponIconType.Missile_light)
                {
                    for (int i = 0; i < batchLaunch; i++)
                    {
                        var obj = Instantiate(weaponData.weaponFx, transform);

                        var fx = obj.GetComponent<WeaponFXBasic>();
                        obj.transform.localPosition = Vector3.zero;
                        fx.FireAndRenderFx(originPoint, targetPosition, Vector3.zero, origin, weaponData.damage, damageMultiplier, i);
                    }
                }
                else
                {
                    var obj = Instantiate(weaponData.weaponFx, transform);

                    var fx = obj.GetComponent<WeaponFXBasic>();
                    obj.transform.localPosition = Vector3.zero;
                    fx.FireAndRenderFx(originPoint, targetPosition, Vector3.zero, origin, weaponData.damage, damageMultiplier, 0);
                    if (fx is BeamFX)
                    {
                        ((BeamFX)fx).lineRenderer.colorGradient = gradient;
                    }
                }
            }
            else
            {
                Debug.Log($"{transform.name}: target not in firing arc. ");
            }
        }
    }

    public bool CheckIfWeaponCanFire(
        Vector3 turretPosition,
        Quaternion turretRotation,
        Vector3 targetPosition){
        
        var firingArcTest = ArcTest.TargetArcTest3D(
            turretPosition: turretPosition,
            turretRotation: turretRotation,
            targetPosition: targetPosition,
            horizontalStartDegree: firingArcSettings.minHorizontalRotationAngle,
            horizontalStopDegree: firingArcSettings.maxHorizontalRotationAngle,
            verticalStartDegree: firingArcSettings.minVerticalRotationAngle,
            verticalStopDegree: firingArcSettings.maxVerticalRotationAngle
            );

        float distanceFromTarget = (cannonCenterPivot.position - targetPosition).magnitude;

        return firingArcTest && distanceFromTarget <= weaponData.range;
    }

    public override void Damage(float amount, FiredEvent firedEvent = null, bool isRaw = false)
    {
        

        float damageRatio =  isRaw ? 1 : blockDamagePercent / 100f;
        healthStats.TakeDamage(damageRatio * amount);
        ship.TakeDamage(amount * (1 - damageRatio), firedEvent);
        
        smokeSystem.CheckTriggerSmoke(healthStats.Percent);

        // if(healthStats.IsDead){
        //     gameObject.SetActive(false);
        // }
    }

    public override void Heal(float amount)
    {
    }

    public override void Init()
    {
        healthStats.startingHealth = weaponData.weaponHealth;
        healthStats.Init();
        smokeSystem.Init();
    }

    public void ResetCooldown()
    {

        //Debug.Log($"reset cooldown: {weaponData.cooldown} <=  {GameManager.Instance.currentTurnNumber} - {lastFired}");
        if(weaponData.cooldown <= GameManager.Instance.currentTurnNumber - lastFired)
        {
            lastFired = -1; // ready to fire again.
        }
    }
}