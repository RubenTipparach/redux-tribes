using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class CannonShotFX : WeaponFXBasic
{

    protected override void Start()
    {

        if (_target != null)
        {
            UpdatePosition();
        }

        if (selfAdd)
        {
            GameManager.Instance.AddSimulator(this);
            Debug.Log(gameObject.name + " added as particle sim");
        }

        if (GameManager.Instance.simulationController.SimulationState == SimulationState.Paused)
        {
            //StartSim();
            OnStopSim();
        }

    }


    public float firingSpeed = 100;
    public override void UpdateSim(float turnTimer, float frameTime)
    {
        //Debug.Log( gameObject.name + " updating weapon fx. " + deltaTime + " " + _fired);
        if (_fired && weaponFx.activeInHierarchy)
        {
            var velocity = Vector3.forward * firingSpeed * frameTime;
            var raycast = transform.forward * 3;

            //var offset = _target.position - origin.position;
            //var len = offset.magnitude;
            //var direction = offset.normalized;
            //var animationLen = len * lineLength.Evaluate(timing.GetProgressClamped);

            //animationLen = RaycastHitDetermineMaxLaserLen(direction, direction * animationLen + offsetFactor, animationLen);

            //var directionAndMagnitude = direction * animationLen + offsetFactor;

            //lineRenderer.SetPositions(new Vector3[] {
            //    origin.position,
            //    origin.position + directionAndMagnitude
            //});

            //// Apply the color and transparency to the property block
            //propBlock.SetFloat("_Fade_overall", fade.Evaluate(timing.GetProgressClamped) * brightness);

            //// Set the property block of the renderer with the updated color
            //lineRenderer.SetPropertyBlock(propBlock);

            // BIG Note for these weapons, we might need to vary these based on frame time.
            Debug.DrawLine(transform.position, transform.position + raycast, Color.red);
            RaycastHitDetermineMaxLaserLen(raycast);
            transform.Translate(velocity, Space.Self);

        }
        else
        {
            weaponFx.gameObject.SetActive(false);
        }

        base.UpdateSim(turnTimer, frameTime);
        
        lastPosition = transform.position;
    }

    bool RaycastHitDetermineMaxLaserLen(Vector3 velocity)
    {
        RaycastHit hit;
        if (Physics.Raycast(transform.position, velocity.normalized, out hit, velocity.magnitude, _includesLayers))
        {
            Debug.Log("hit something");
            if (HitTargetDetection(hit))
            {

                return true;
            }
        }
        
        return false;
        
    }

    protected override void UpdatePosition()
    {
        transform.position = _origin.position;
        Vector3 direction = _target.position - _origin.position;
        var rotation = Quaternion.LookRotation(direction.normalized);
        transform.rotation = rotation;
    }
}
